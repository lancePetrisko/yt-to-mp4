# YT Downloader

A local desktop app for downloading YouTube videos as MP4 or MP3. Built with Electron + Node.js.

![Dark UI with download queue, progress bars, quality selector, and format toggle](https://via.placeholder.com/800x450?text=YT+Downloader+Screenshot)

## Features

- Download queue — add multiple URLs and start them all at once
- Quality selector — 2160p, 1080p, 720p, 480p, 360p per item
- Format toggle — MP4 (video) or MP3 (audio only) per item
- Custom output folder — folder picker, persists for the session
- Real-time progress bars — parsed from yt-dlp stdout
- Per-download logs — view the full yt-dlp output for debugging
- Cancel individual downloads mid-stream

## Prerequisites

Install these system binaries and ensure they are on your PATH:

| Tool | Install |
|------|---------|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | `pip install yt-dlp` or `winget install yt-dlp` |
| [ffmpeg](https://ffmpeg.org) | `winget install ffmpeg` or `choco install ffmpeg` |

Verify both work:

```bash
yt-dlp --version
ffmpeg -version
```

> **Windows note:** If yt-dlp was installed via pip and isn't on PATH, the app automatically falls back to `python -m yt_dlp`. ffmpeg is auto-detected from common install locations even if not on PATH.

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

```bash
npm run build
```

This produces an NSIS installer at `dist/YT Downloader Setup x.x.x.exe`.

For a standalone portable executable (no install required):

```bash
npm run build:portable
```

Build output goes to `dist/` (gitignored).

## Stack

- **Electron** — desktop window
- **Node.js + Express** — local backend on port 3131
- **Vanilla JS** — no frontend frameworks
- **yt-dlp** — YouTube downloading
- **ffmpeg** — merging video + audio streams, re-encoding audio to AAC

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

Each download writes a timestamped log. Click the **Logs** button on any queue item to view it in-app.

- **Development:** `logs/<id>.log` (project root)
- **Installed app:** `%APPDATA%/yt-downloader/logs/<id>.log`
