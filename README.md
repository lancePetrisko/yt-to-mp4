# YTDown

A local desktop app for downloading YouTube, Twitch, and Kick videos as MP4 or MP3. Built with Electron + Node.js.

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
- See File — opens the output file in Explorer when complete
- Version displayed in the title bar, driven by `package.json`

## Prerequisites

| Tool | Install |
|------|---------|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | `pip install yt-dlp` or `winget install yt-dlp` |
| [ffmpeg](https://ffmpeg.org) | `winget install ffmpeg` or `choco install ffmpeg` |

Verify both work:

```bash
yt-dlp --version
ffmpeg -version
```

> **Windows note:** If yt-dlp was installed via pip and isn't on PATH, the app automatically falls back to `python -m yt_dlp`. ffmpeg is auto-detected from common install locations (winget, chocolatey, scoop, Program Files) even if not on PATH.

## Install (end-user)

1. Make sure [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org) are installed (see Prerequisites above)
2. Download `YT Downloader Setup x.x.x.exe` from the [Releases](https://github.com/lancePetrisko/yt-to-mp4/releases) page
3. Run the installer — choose your install directory when prompted
4. Launch **YT Downloader** from the Start Menu or desktop shortcut

## Development

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

For a standalone portable executable (no install required):

```bash
npm run build:portable
```

Build output goes to `dist/` (gitignored).

## Stack

- **Electron** — desktop window
- **Node.js + Express** — local backend on port 3131
- **Vanilla JS** — no frontend frameworks
- **yt-dlp** — video downloading (YouTube, Twitch, Kick)
- **ffmpeg** — merging video + audio streams, re-encoding audio to AAC for Windows compatibility

## Project Structure

```
yt-to-mp4/
├── main.js           # Electron main process, boots Express
├── preload.js        # contextBridge IPC (window.electronAPI)
├── package.json
├── build/
│   └── icon.ico      # App icon (used by installer)
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
- **Installed app:** `%APPDATA%/yt-downloader/logs/<id>.log`
