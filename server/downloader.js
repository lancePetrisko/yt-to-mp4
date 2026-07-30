const express = require('express');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const IS_WINDOWS = process.platform === 'win32';
const EXE = IS_WINDOWS ? '.exe' : '';

// Binaries shipped inside the installer, so a user never has to install yt-dlp or
// ffmpeg by hand. Packaged builds get them via electron-builder extraResources
// (resources/bin); running from source falls back to whatever
// `npm run fetch-binaries` dropped in build/bin/<platform>-<arch>/.
function getBundledBinary(name) {
  const file = `${name}${EXE}`;
  const candidates = [];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', file));
  }
  candidates.push(
    path.join(__dirname, '..', 'build', 'bin', `${process.platform}-${process.arch}`, file)
  );

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) {}
  }
  return null;
}

// Look a command up on PATH using the OS's own resolver.
function whichOnPath(command) {
  try {
    // Full path to where.exe so it reads the live registry PATH — Electron's
    // inherited PATH is stale (see notes in CLAUDE.md).
    const cmd = IS_WINDOWS
      ? `C:\\Windows\\System32\\where.exe ${command}`
      : `/usr/bin/which ${command}`;
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const found = result.split('\n')[0].trim();
    return found || null;
  } catch (_) {
    return null;
  }
}

// Find ffmpeg: bundled copy first, then PATH, then common install locations so it
// works even when Electron's PATH is stale.
let ffmpegPath = null;
function getFfmpegPath() {
  if (ffmpegPath) return ffmpegPath;

  // 1. Bundled with the app — the normal case for installed builds
  const bundled = getBundledBinary('ffmpeg');
  if (bundled) { ffmpegPath = bundled; return ffmpegPath; }

  // 2. On PATH
  const onPath = whichOnPath('ffmpeg');
  if (onPath) { ffmpegPath = onPath; return ffmpegPath; }

  // 3. Scan common install locations
  const macLinuxCandidates = IS_WINDOWS ? [] : [
    '/opt/homebrew/bin/ffmpeg',      // Homebrew on Apple Silicon
    '/usr/local/bin/ffmpeg',         // Homebrew on Intel / manual installs
    '/opt/local/bin/ffmpeg',         // MacPorts
    '/usr/bin/ffmpeg',
    path.join(os.homedir(), 'bin', 'ffmpeg'),
  ];

  const candidates = [
    ...macLinuxCandidates,
    // winget default package dirs
    ...(() => {
      try {
        const pkgs = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
        if (!fs.existsSync(pkgs)) return [];
        return fs.readdirSync(pkgs)
          .filter(d => d.toLowerCase().startsWith('gyan.ffmpeg'))
          .flatMap(d => {
            const sub = path.join(pkgs, d);
            try {
              return fs.readdirSync(sub).map(s => path.join(sub, s, 'bin', 'ffmpeg.exe'));
            } catch (_) { return []; }
          });
      } catch (_) { return []; }
    })(),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(os.homedir(), 'ffmpeg', 'bin', 'ffmpeg.exe'),
    path.join(os.homedir(), 'scoop', 'shims', 'ffmpeg.exe'),
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) { ffmpegPath = c; return ffmpegPath; }
    } catch (_) {}
  }

  return null;
}

// Ways to invoke yt-dlp, best first: the copy shipped in the installer, then one
// on PATH, then a pip install that isn't on PATH.
function getYtDlpInvocations() {
  const invocations = [];

  const bundled = getBundledBinary('yt-dlp');
  if (bundled) invocations.push({ cmd: bundled, prefix: [], label: 'bundled yt-dlp' });

  invocations.push({ cmd: 'yt-dlp', prefix: [], label: 'yt-dlp on PATH' });

  const pythons = IS_WINDOWS ? ['python', 'py'] : ['python3', 'python'];
  for (const python of pythons) {
    invocations.push({ cmd: python, prefix: ['-m', 'yt_dlp'], label: `${python} -m yt_dlp` });
  }

  return invocations;
}

// Spawn yt-dlp, walking the fallback list until one actually launches. Resolves
// with the live process; rejects only if every option is missing.
async function spawnYtDlp(args) {
  let lastErr = null;

  for (const invocation of getYtDlpInvocations()) {
    const proc = spawn(invocation.cmd, [...invocation.prefix, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    try {
      await new Promise((resolve, reject) => {
        proc.once('error', reject);
        proc.once('spawn', resolve);
      });
      return { proc, invocation };
    } catch (err) {
      lastErr = err;
      // Anything other than "not installed" is a real failure worth surfacing.
      if (err.code !== 'ENOENT') throw err;
    }
  }

  throw lastErr || new Error('yt-dlp not found');
}

function detectPlatform(url) {
  if (/twitch\.tv\/videos\//i.test(url)) return 'twitch';
  if (/kick\.com/i.test(url))            return 'kick';
  return 'youtube';
}

const app = express();
app.use(express.json());

// Map of id -> { item, process, logs[], status }
const downloads = new Map();
let progressCallback = null;

let logsDir = path.join(__dirname, '..', 'logs');

// Where downloads land when the user hasn't picked a folder. Electron passes the
// real OS Downloads path in via startExpressServer; this is only the fallback for
// running the server outside Electron.
let defaultFolder = path.join(os.homedir(), 'Downloads');

function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

function timestamp() {
  return new Date().toISOString();
}

function appendLog(id, source, text) {
  const entry = downloads.get(id);
  if (!entry) return;
  const line = `[${timestamp()}] [${source}] ${text}`;
  entry.logs.push(line);
  // Also append to log file
  const logFile = path.join(logsDir, `${id}.log`);
  fs.appendFile(logFile, line + '\n', () => {});
}

function emitProgress(id, percent, status, message, filePath) {
  if (progressCallback) {
    progressCallback({ id, percent, status, message, filePath });
  }
}

// Parse yt-dlp progress lines
// Examples:
//   [download]  12.5% of   45.23MiB at    2.50MiB/s ETA 00:17
//   [download] 100% of   45.23MiB
function parsePercent(line) {
  const match = line.match(/\[download\]\s+([\d.]+)%/);
  if (match) return parseFloat(match[1]);
  return null;
}

function buildArgs(item, ffmpeg) {
  const { url, quality, format, outputFolder } = item;
  const platform = item.platform || detectPlatform(url);
  const folder = outputFolder || defaultFolder;
  // yt-dlp won't create a missing destination root, so make sure it exists.
  try {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  } catch (_err) {
    /* fall through — yt-dlp will report the write failure in the log */
  }
  const outputTemplate = path.join(folder, '%(title)s.%(ext)s');

  const ffmpegArgs = ffmpeg ? ['--ffmpeg-location', ffmpeg] : [];

  // MP3 — also triggered by Twitch "Audio Only" quality
  if (format === 'mp3' || (platform === 'twitch' && quality === 'audio')) {
    return [
      '-x',
      '--audio-format', 'mp3',
      '--no-playlist',
      ...ffmpegArgs,
      '-o', outputTemplate,
      url,
    ];
  }

  // Build platform-specific format string
  let formatStr;
  let postprocArgs = [];

  if (platform === 'twitch') {
    // Twitch uses named format IDs, not height filters.
    // Twitch VODs already have AAC audio — skip re-encode.
    const twitchFormats = {
      source:  'chunked/best',
      '720p60': '720p60/chunked/best',
      '480p30': '480p30/720p60/chunked/best',
      '360p30': '360p30/480p30/chunked/best',
    };
    formatStr = twitchFormats[quality] || 'chunked/best';
  } else if (platform === 'kick') {
    // Kick serves VODs as pre-muxed HLS streams — no separate audio track.
    // Requires curl_cffi for browser impersonation to bypass Kick's 403 protection:
    //   pip install curl_cffi
    const heightMap = { best: null, '1080p': 1080, '720p': 720, '480p': 480, '360p': 360 };
    const height = heightMap[quality];
    formatStr = height ? `b[height<=${height}]/b` : 'b';
    // HLS streams from Kick are already in a playable container — no postproc needed.
  } else {
    // YouTube: separate DASH video+audio streams, merge and re-encode audio to AAC
    // so Windows can always play the output.
    const heightMap = {
      '2160p': 2160, '1080p': 1080, '720p': 720, '480p': 480, '360p': 360,
    };
    const height = heightMap[quality];
    formatStr = height
      ? `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`
      : 'bestvideo+bestaudio/best';
    postprocArgs = ['--postprocessor-args', 'ffmpeg:-c:a aac -q:a 0'];
  }

  const impersonateArgs = platform === 'kick' ? ['--impersonate', 'chrome'] : [];

  return [
    '-f', formatStr,
    '--merge-output-format', 'mp4',
    ...postprocArgs,
    '--no-playlist',
    ...impersonateArgs,
    ...ffmpegArgs,
    '-o', outputTemplate,
    url,
  ];
}

// POST /info — fetch video title + thumbnail without downloading
app.post('/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  const args = ['--print', 'title', '--print', 'thumbnail', '--no-warnings', '--skip-download', url];

  let proc;
  try {
    ({ proc } = await spawnYtDlp(args));
  } catch (spawnErr) {
    return res.json({
      error: spawnErr.code === 'ENOENT' ? 'yt-dlp not found' : spawnErr.message,
    });
  }

  let stdout = '';
  proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });

  proc.on('close', (code) => {
    if (code !== 0) return res.json({ error: `yt-dlp exited with code ${code}` });
    const lines = stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
    res.json({ title: lines[0] || null, thumbnail: lines[1] || null });
  });
});

// POST /add — register a download item, return id
app.post('/add', (req, res) => {
  const { url, quality, format, outputFolder, platform: clientPlatform } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  const platform = (clientPlatform && ['youtube', 'twitch', 'kick'].includes(clientPlatform))
    ? clientPlatform
    : detectPlatform(url);

  const defaultQuality = platform === 'twitch' ? 'source' : platform === 'kick' ? 'best' : '1080p';
  const resolvedQuality = quality || defaultQuality;

  const id = generateId();
  downloads.set(id, {
    item: { url, quality: resolvedQuality, format: format || 'mp4', outputFolder, platform },
    process: null,
    status: 'queued',
    logs: [],
    filePath: null,
  });
  appendLog(id, 'INFO', `Queued: ${url} | platform=${platform} quality=${resolvedQuality} format=${format || 'mp4'}`);
  res.json({ id, platform });
});

// POST /start — begin downloading a queued item
app.post('/start', async (req, res) => {
  const { id } = req.body;
  const entry = downloads.get(id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  if (entry.process) return res.status(400).json({ error: 'already running' });

  const ffmpeg = getFfmpegPath();
  appendLog(id, 'INFO', ffmpeg ? `ffmpeg found: ${ffmpeg}` : 'ffmpeg not found — merge will be skipped');
  const args = buildArgs(entry.item, ffmpeg);
  appendLog(id, 'CMD', `yt-dlp ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);

  // Bundled binary first, then PATH, then a pip install that isn't on PATH
  let proc;
  try {
    const launched = await spawnYtDlp(args);
    proc = launched.proc;
    appendLog(id, 'INFO', `Using ${launched.invocation.label}`);
  } catch (spawnErr) {
    const message = spawnErr.code === 'ENOENT'
      ? 'yt-dlp not found. Reinstall the app, or install yt-dlp and put it on PATH.'
      : spawnErr.message;
    appendLog(id, 'STDERR', `Failed to launch yt-dlp: ${spawnErr.message}`);
    entry.process = null;
    entry.status = 'error';
    emitProgress(id, null, 'error', message);
    return res.json({ ok: true });
  }

  entry.process = proc;
  entry.status = 'downloading';
  emitProgress(id, 0, 'downloading', 'Starting...');

  proc.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      appendLog(id, 'STDOUT', trimmed);
      const pct = parsePercent(line);
      if (pct !== null) {
        emitProgress(id, pct, 'downloading', trimmed);
      }
      // Detect merge/post-processing
      if (line.includes('[Merger]') || line.includes('Merging formats')) {
        emitProgress(id, 99, 'merging', 'Merging video and audio...');
      }
      // Track the output file path from yt-dlp output lines
      const mergerMatch = trimmed.match(/\[Merger\] Merging formats into "(.+)"$/);
      if (mergerMatch) { entry.filePath = mergerMatch[1]; }
      const destMatch = trimmed.match(/\[(?:download|ExtractAudio|VideoConvertor)\] Destination: (.+)$/);
      if (destMatch) { entry.filePath = destMatch[1]; }
      const moveMatch = trimmed.match(/\[MoveFiles\] Moving file ".*?" to "(.+)"$/);
      if (moveMatch) { entry.filePath = moveMatch[1]; }
      const alreadyMatch = trimmed.match(/^\[download\] (.+) has already been downloaded$/);
      if (alreadyMatch) { entry.filePath = alreadyMatch[1]; }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      appendLog(id, 'STDERR', text);
      // yt-dlp writes WARNINGs to stderr — don't treat those as fatal errors
      if (!text.startsWith('WARNING:')) {
        emitProgress(id, null, 'error', text);
      }
    }
  });

  proc.on('close', (code) => {
    entry.process = null;
    appendLog(id, 'EXIT', `yt-dlp exited with code ${code}`);
    if (code === 0) {
      entry.status = 'done';
      emitProgress(id, 100, 'done', 'Complete', entry.filePath);
    } else if (code === null) {
      entry.status = 'cancelled';
      emitProgress(id, null, 'cancelled', 'Cancelled');
    } else {
      entry.status = 'error';
      emitProgress(id, null, 'error', `yt-dlp exited with code ${code}`);
    }
  });

  res.json({ ok: true });
});

// POST /cancel — kill an in-progress download
app.post('/cancel', (req, res) => {
  const { id } = req.body;
  const entry = downloads.get(id);
  if (!entry) return res.status(404).json({ error: 'not found' });

  if (entry.process) {
    try {
      process.kill(entry.process.pid, 'SIGTERM');
    } catch (_) {
      entry.process.kill();
    }
    entry.process = null;
  }
  entry.status = 'cancelled';
  appendLog(id, 'INFO', 'Cancelled by user');
  emitProgress(id, null, 'cancelled', 'Cancelled');
  res.json({ ok: true });
});

// GET /logs/:id — return the full log for a download
app.get('/logs/:id', (req, res) => {
  const entry = downloads.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  res.json({ id: req.params.id, logs: entry.logs });
});

function startExpressServer(onProgress, userDataPath, defaultDownloadDir) {
  progressCallback = onProgress;
  if (userDataPath) {
    logsDir = path.join(userDataPath, 'logs');
  }
  if (defaultDownloadDir) {
    defaultFolder = defaultDownloadDir;
  }
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  app.listen(3131, '127.0.0.1', () => {
    console.log('Express server running on http://127.0.0.1:3131');
  });
}

module.exports = { startExpressServer };
