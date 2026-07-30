#!/usr/bin/env node
/**
 * Downloads the yt-dlp and ffmpeg binaries that get bundled into the installers,
 * so end users don't have to install anything themselves.
 *
 * Binaries land in build/bin/<platform>-<arch>/ and are wired into the packaged
 * app by electron-builder's extraResources (see the "build" block in package.json).
 * That directory is gitignored — it is a build artifact, not source.
 *
 * LICENSING: every ffmpeg build here is checked for `--enable-nonfree`, which marks
 * a binary that combines license-incompatible components and CANNOT be redistributed
 * by anyone. A hit fails the build rather than shipping something unpublishable.
 * See THIRD-PARTY-NOTICES.md for what has to accompany a release.
 *
 *   node scripts/fetch-binaries.js                      # host platform
 *   node scripts/fetch-binaries.js --platform=win32     # cross-fetch for Windows
 *   node scripts/fetch-binaries.js --platform=darwin --arch=arm64
 *   node scripts/fetch-binaries.js --all                # every target we ship
 *   node scripts/fetch-binaries.js --force              # re-download existing
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BIN_ROOT = path.join(ROOT, 'build', 'bin');

// ffmpeg 8.1, GPL builds, pinned rather than rolling so the binary keeps matching
// the source we point at for GPL compliance.
//
// Windows: BtbN publishes versioned win64 builds.
// macOS:   martin-riedl.de is the one maintained source of static macOS builds for
//          both arches that is NOT compiled with --enable-nonfree. (The widely used
//          evermeet/ffmpeg-static macOS builds are nonfree and unredistributable.)
const YTDLP_RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const BTBN = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest';
const MARTIN_RIEDL = 'https://ffmpeg.martin-riedl.de/redirect/latest/macos';

const TARGETS = {
  'win32-x64': {
    ffmpeg: {
      url: `${BTBN}/ffmpeg-n8.1-latest-win64-gpl-8.1.zip`,
      archive: 'zip',
      member: 'ffmpeg.exe',
      out: 'ffmpeg.exe',
    },
    ytdlp: { url: `${YTDLP_RELEASE}/yt-dlp.exe`, out: 'yt-dlp.exe' },
  },
  'darwin-x64': {
    ffmpeg: {
      url: `${MARTIN_RIEDL}/amd64/release/ffmpeg.zip`,
      archive: 'zip',
      member: 'ffmpeg',
      out: 'ffmpeg',
    },
    // yt-dlp_macos is a universal2 build, so the same file serves both Mac arches.
    ytdlp: { url: `${YTDLP_RELEASE}/yt-dlp_macos`, out: 'yt-dlp' },
  },
  'darwin-arm64': {
    ffmpeg: {
      url: `${MARTIN_RIEDL}/arm64/release/ffmpeg.zip`,
      archive: 'zip',
      member: 'ffmpeg',
      out: 'ffmpeg',
    },
    ytdlp: { url: `${YTDLP_RELEASE}/yt-dlp_macos`, out: 'yt-dlp' },
  },
};

function parseArgs(argv) {
  const opts = { force: false, all: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--force') opts.force = true;
    else if (arg === '--all') opts.all = true;
    else if (arg.startsWith('--platform=')) opts.platform = arg.split('=')[1];
    else if (arg.startsWith('--arch=')) opts.arch = arg.split('=')[1];
    else {
      console.error(`fetch-binaries: unknown argument "${arg}"`);
      process.exit(1);
    }
  }
  return opts;
}

function download(url, dest, redirects = 0) {
  if (redirects > 10) return Promise.reject(new Error('too many redirects'));

  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'yt-downloader-build' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          // Location may be relative (martin-riedl.de redirects that way), so
          // resolve it against the URL we just requested.
          const next = new URL(res.headers.location, url).toString();
          resolve(download(next, dest, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }

        const total = Number(res.headers['content-length']) || 0;
        let seen = 0;
        let lastPrint = 0;

        // Write to a temp file so an interrupted download can't leave a
        // truncated binary that later runs would treat as already fetched.
        const tmp = `${dest}.part`;
        const file = fs.createWriteStream(tmp);

        res.on('data', (chunk) => {
          seen += chunk.length;
          const now = Date.now();
          if (total && now - lastPrint > 500) {
            lastPrint = now;
            const pct = ((seen / total) * 100).toFixed(0);
            process.stdout.write(`\r    ${pct}%  (${(seen / 1048576).toFixed(1)}MB)   `);
          }
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            if (total && seen !== total) {
              fs.unlinkSync(tmp);
              reject(new Error(`size mismatch: got ${seen} of ${total} bytes`));
              return;
            }
            fs.renameSync(tmp, dest);
            process.stdout.write(`\r    downloaded (${(seen / 1048576).toFixed(1)}MB)     \n`);
            resolve();
          });
        });
        file.on('error', (err) => {
          fs.existsSync(tmp) && fs.unlinkSync(tmp);
          reject(err);
        });
      })
      .on('error', reject);
  });
}

// Extract `member` out of a zip and move it to `dest`. Uses the OS unzip so we
// don't take on a dependency just for this.
function extractFromZip(zipPath, member, dest) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdown-bin-'));

  try {
    if (process.platform === 'win32') {
      execFileSync('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmpDir}' -Force`,
      ], { stdio: 'ignore' });
    } else {
      execFileSync('unzip', ['-oq', zipPath, '-d', tmpDir], { stdio: 'ignore' });
    }

    // Archives nest the binary differently per source (BtbN uses <name>/bin/),
    // so search rather than assuming a layout.
    const found = findFile(tmpDir, member);
    if (!found) throw new Error(`"${member}" not found inside ${path.basename(zipPath)}`);

    fs.copyFileSync(found, dest);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
  }
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

// Pull the ffmpeg ./configure line straight out of the binary. Used both for the
// nonfree check and to record what was shipped, which GPL compliance needs.
function readBuildConfig(binaryPath) {
  const buf = fs.readFileSync(binaryPath);
  const start = buf.indexOf('--prefix=');
  if (start === -1) return null;

  let end = start;
  while (end < buf.length && buf[end] >= 0x20 && buf[end] < 0x7f && end - start < 8000) end++;
  return buf.toString('latin1', start, end);
}

function assertRedistributable(name, binaryPath) {
  if (name !== 'ffmpeg') return null;

  const config = readBuildConfig(binaryPath);
  if (!config) {
    console.log('    warning: could not read build configuration to verify licensing');
    return null;
  }

  if (config.includes('--enable-nonfree')) {
    throw new Error(
      `${path.basename(binaryPath)} was built with --enable-nonfree and cannot be ` +
      `legally redistributed. Refusing to bundle it.`
    );
  }

  const license = config.includes('--enable-gpl') ? 'GPL' : 'LGPL';
  console.log(`    license: ${license} (no --enable-nonfree)`);
  return { config, license };
}

async function fetchTarget(key, force) {
  const target = TARGETS[key];
  if (!target) {
    console.error(`fetch-binaries: no binaries defined for "${key}"`);
    console.error(`  known targets: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }

  const outDir = path.join(BIN_ROOT, key);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`\n${key}`);

  const provenance = [`# Bundled binaries for ${key}`, `# Generated by scripts/fetch-binaries.js`, ''];

  for (const [name, spec] of Object.entries(target)) {
    const dest = path.join(outDir, spec.out);

    if (fs.existsSync(dest) && !force) {
      console.log(`  ${name}: already present (--force to re-download)`);
      assertRedistributable(name, dest);
      continue;
    }

    console.log(`  ${name}: ${spec.url}`);
    if (spec.archive === 'zip') {
      const zipPath = `${dest}.zip`;
      await download(spec.url, zipPath);
      extractFromZip(zipPath, spec.member, dest);
      console.log(`    extracted ${spec.member}`);
    } else {
      await download(spec.url, dest);
    }

    // Needs to be executable on macOS/Linux; harmless on Windows.
    fs.chmodSync(dest, 0o755);

    const info = assertRedistributable(name, dest);
    provenance.push(`${spec.out}`, `  source: ${spec.url}`);
    if (info) {
      provenance.push(`  license: ${info.license}`);
      provenance.push(`  configuration: ${info.config}`);
    }
    provenance.push('');
  }

  fs.writeFileSync(path.join(outDir, 'BUILD-INFO.txt'), provenance.join('\n'));
}

async function main() {
  const opts = parseArgs(process.argv);
  const keys = opts.all
    ? Object.keys(TARGETS)
    : [`${opts.platform || process.platform}-${opts.arch || process.arch}`];

  for (const key of keys) {
    await fetchTarget(key, opts.force);
  }
  console.log(`\nBinaries ready in build/bin/`);
}

main().catch((err) => {
  console.error(`\nfetch-binaries failed: ${err.message}`);
  process.exit(1);
});
