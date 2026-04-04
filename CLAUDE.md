# YT Downloader — Claude Code Notes

## Project overview
Electron + Express (port 3131) desktop app that wraps yt-dlp and ffmpeg to download YouTube videos as MP4/MP3.

## Architecture
- `main.js` — Electron main process, boots Express, IPC handlers
- `preload.js` — contextBridge exposing `window.electronAPI`
- `renderer/` — vanilla JS frontend (no frameworks)
- `server/downloader.js` — Express routes, spawns yt-dlp child processes, ffmpeg detection, per-download logging

## Key technical decisions

### yt-dlp invocation
- Primary: tries spawning `yt-dlp` directly
- Fallback: `python -m yt_dlp` (pip user install may not be on PATH)
- Uses `await` on the spawn/error events to detect ENOENT before proceeding

### ffmpeg detection
- Electron inherits PATH from when it launched, NOT the current system PATH
- `where.exe` also fails inside Electron for the same reason
- Solution: `getFfmpegPath()` scans common install locations (winget packages dir, Program Files, chocolatey, scoop, etc.)
- The resolved path is passed via `--ffmpeg-location <path>` to yt-dlp

### Audio codec
- YouTube serves audio as Opus (webm) which Windows can't play natively
- `--postprocessor-args "ffmpeg:-c:a aac -q:a 0"` forces re-encoding to AAC during merge
- This ensures the output MP4 plays in Windows Media Player / Movies & TV

### Logging
- Each download gets a timestamped log in `logs/<id>.log`
- Captures: CMD invoked, all stdout/stderr, exit code
- Viewable in-app via the Logs button per queue item
- Logs dir is gitignored

## Commands
- `npm start` — run the app
- `npm run dev` — run with DevTools inspector

## Dependencies
- System: yt-dlp (via pip or standalone), ffmpeg (via winget/choco/manual)
- npm: express, electron
