# YTDown

A local desktop app for downloading YouTube, Twitch, and Kick videos as MP4 or MP3. Built with Electron + Node.js. Runs on Windows and macOS.

Developed and maintained by [Lance Petrisko](https://lancepetrisko.com).

## Features

- Multi-platform — YouTube, Twitch VODs, and Kick
- Download queue — add multiple URLs and start them all at once
- Quality selector — 2160p, 1080p, 720p, 480p, 360p per item (platform-aware)
- Format toggle — MP4 (video) or MP3 (audio only) per item
- Custom output folder — folder picker, persists for the session
- Real-time progress bars — parsed from yt-dlp stdout
- Per-download logs — view the full yt-dlp output for debugging
- Cancel individual downloads mid-stream
- See File — reveals the output file in Explorer (Windows) or Finder (macOS)
- Version displayed in the title bar, driven by `package.json`

## Prerequisites

Both tools must be installed on the system.

**macOS** ([Homebrew](https://brew.sh)):

```bash
brew install yt-dlp ffmpeg
```

**Windows:**

```powershell
winget install yt-dlp
winget install ffmpeg
```

`pip install yt-dlp` and `choco install ffmpeg` also work.

Verify both:

```bash
yt-dlp --version
ffmpeg -version
```

> **macOS note:** ffmpeg is resolved from `PATH` by yt-dlp itself. If the app reports ffmpeg missing while `ffmpeg -version` works in your shell, launch the app from a terminal (`npm start`) so it inherits your shell `PATH` — Electron launched from Finder gets a minimal `PATH` that omits `/opt/homebrew/bin`.
>
> **Windows note:** If yt-dlp was installed via pip and isn't on `PATH`, the app falls back to `python -m yt_dlp`. ffmpeg is auto-detected from common install locations (winget, chocolatey, scoop, Program Files) even if not on `PATH`.

## Install (end-user)

1. Install [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org) (see Prerequisites above)
2. **Windows:** download `YT Downloader Setup x.x.x.exe` from the [Releases](https://github.com/lancePetrisko/yt-to-mp4/releases) page, run the installer, choose an install directory, then launch **YT Downloader** from the Start Menu
3. **macOS:** no prebuilt release yet — run from source (see Development below)

## Development

Requires Node.js 18+.

```bash
git clone https://github.com/lancePetrisko/yt-to-mp4.git
cd yt-to-mp4
npm install
npm start
```

To open with DevTools:

```bash
npm run dev
```

### Building the installer

Bump the `version` field in `package.json` first, then:

```bash
npm run build
```

This produces an NSIS installer at `dist/YT Downloader Setup x.x.x.exe`. The version is stamped into the installer and shown in the app UI automatically.

For a standalone portable Windows executable (no install required):

```bash
npm run build:portable
```

Build output goes to `dist/` (gitignored).

> Both build scripts target Windows (`electron-builder --win`). Producing a macOS `.dmg` requires adding a `mac` target to the `build` block in `package.json` and building on a Mac. On macOS, `npm start` runs the app directly with no build step.

## Stack

- **Electron** — desktop window
- **Node.js + Express** — local backend on port 3131
- **Vanilla JS** — no frontend frameworks
- **yt-dlp** — video downloading (YouTube, Twitch, Kick)
- **ffmpeg** — merging video + audio streams, re-encoding audio to AAC so the MP4 plays in Windows Media Player and QuickTime

## Project Structure

```
yt-to-mp4/
├── main.js           # Electron main process, boots Express
├── preload.js        # contextBridge IPC (window.electronAPI)
├── package.json
├── build/
│   └── icon.ico      # App icon (used by the Windows installer)
├── renderer/
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── server/
    └── downloader.js # yt-dlp/ffmpeg wrapper + Express routes
```

## Logs

Each download writes a timestamped log capturing the full yt-dlp command, stdout, stderr, and exit code. Click the **Logs** button on any queue item to view it in-app.

- **Development:** `logs/<id>.log` (project root)
- **Installed app (Windows):** `%APPDATA%/yt-downloader/logs/<id>.log`
- **Installed app (macOS):** `~/Library/Application Support/yt-downloader/logs/<id>.log`
