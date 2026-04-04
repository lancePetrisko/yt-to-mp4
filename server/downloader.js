const express = require('express');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Find ffmpeg by checking PATH via where.exe, then falling back to
// common install locations so it works even when Electron's PATH is stale.
let ffmpegPath = null;
function getFfmpegPath() {
  if (ffmpegPath) return ffmpegPath;

  // 1. Try where.exe with the full system32 path so it reads the live registry PATH
  try {
    const result = execSync('C:\\Windows\\System32\\where.exe ffmpeg', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const found = result.split('\n')[0].trim();
    if (found) { ffmpegPath = found; return ffmpegPath; }
  } catch (_) {}

  // 2. Scan common install locations
  const candidates = [
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

const app = express();
app.use(express.json());

// Map of id -> { item, process, logs[], status }
const downloads = new Map();
let progressCallback = null;

const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

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

function emitProgress(id, percent, status, message) {
  if (progressCallback) {
    progressCallback({ id, percent, status, message });
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
  const folder = outputFolder || os.homedir();
  const outputTemplate = path.join(folder, '%(title)s.%(ext)s');

  const ffmpegArgs = ffmpeg ? ['--ffmpeg-location', ffmpeg] : [];

  if (format === 'mp3') {
    return [
      '-x',
      '--audio-format', 'mp3',
      '--no-playlist',
      ...ffmpegArgs,
      '-o', outputTemplate,
      url,
    ];
  }

  // MP4 — re-encode audio to AAC so Windows can always play the output.
  const height = quality.replace('p', '');
  return [
    '-f', `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
    '--merge-output-format', 'mp4',
    '--postprocessor-args', 'ffmpeg:-c:a aac -q:a 0',
    '--no-playlist',
    ...ffmpegArgs,
    '-o', outputTemplate,
    url,
  ];
}

// POST /add — register a download item, return id
app.post('/add', (req, res) => {
  const { url, quality, format, outputFolder } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  const id = generateId();
  downloads.set(id, {
    item: { url, quality: quality || '1080p', format: format || 'mp4', outputFolder },
    process: null,
    status: 'queued',
    logs: [],
  });
  appendLog(id, 'INFO', `Queued: ${url} | quality=${quality || '1080p'} format=${format || 'mp4'}`);
  res.json({ id });
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

  // Try yt-dlp directly first; fall back to python -m yt_dlp if not on PATH
  let proc;
  try {
    proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    // Test immediately if the binary was found
    await new Promise((resolve, reject) => {
      proc.once('error', reject);
      proc.once('spawn', resolve);
    });
  } catch (spawnErr) {
    if (spawnErr.code === 'ENOENT') {
      appendLog(id, 'INFO', 'yt-dlp not found on PATH, retrying with python -m yt_dlp');
      proc = spawn('python', ['-m', 'yt_dlp', ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      try {
        await new Promise((resolve, reject) => {
          proc.once('error', reject);
          proc.once('spawn', resolve);
        });
      } catch (err2) {
        appendLog(id, 'STDERR', `Failed to launch yt-dlp: ${err2.message}`);
        entry.process = null;
        entry.status = 'error';
        emitProgress(id, null, 'error', 'yt-dlp not found. Install it and ensure it is on PATH.');
        return res.json({ ok: true });
      }
    } else {
      appendLog(id, 'STDERR', `Spawn error: ${spawnErr.message}`);
      entry.process = null;
      entry.status = 'error';
      emitProgress(id, null, 'error', spawnErr.message);
      return res.json({ ok: true });
    }
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
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      appendLog(id, 'STDERR', text);
      emitProgress(id, null, 'error', text);
    }
  });

  proc.on('close', (code) => {
    entry.process = null;
    appendLog(id, 'EXIT', `yt-dlp exited with code ${code}`);
    if (code === 0) {
      entry.status = 'done';
      emitProgress(id, 100, 'done', 'Complete');
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

function startExpressServer(onProgress) {
  progressCallback = onProgress;
  app.listen(3131, '127.0.0.1', () => {
    console.log('Express server running on http://127.0.0.1:3131');
  });
}

module.exports = { startExpressServer };
