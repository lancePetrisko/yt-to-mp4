# YTDown — Claude Code Notes

## Project overview
Electron + Express (port 3131) desktop app that wraps yt-dlp and ffmpeg to download YouTube, Twitch VOD, and Kick videos as MP4/MP3.

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

### Output file path tracking
- yt-dlp stdout is parsed for several patterns to capture the final output path:
  - `[download] Destination: <path>` — initial file write
  - `[Merger] Merging formats into "<path>"` — post-merge output
  - `[ExtractAudio] Destination: <path>` — MP3 extraction
  - `[MoveFiles] Moving file "..." to "<path>"` — post-processor move
  - `[download] <path> has already been downloaded` — cached file
- The resolved path is sent with the `done` progress event and shown in the UI
- `shell.showItemInFolder` opens Explorer with the file highlighted ("See File" button)

### stderr filtering
- yt-dlp writes `WARNING:` lines to stderr that are non-fatal (e.g. missing JS runtime)
- Only non-WARNING stderr lines flip the card status to error

### Logging
- Each download gets a timestamped log in `logs/<id>.log`
- Captures: CMD invoked, all stdout/stderr, exit code
- Viewable in-app via the Logs button per queue item
- Logs dir is gitignored

### Version display
- `app.getVersion()` is exposed via IPC (`get-version`) and shown next to the title in the header
- Version is driven by the `version` field in `package.json`

### Automatic version bumping
- Patch version bumps itself once per push batch — no manual editing before a release
- `.githooks/pre-commit` bumps on the first commit made after the last push; later commits in
  the same batch skip it, so one push = one increment regardless of commit count
- `.githooks/pre-push` is a safety net: if a batch would reach GitHub with no version change
  (commits made with `--no-verify`), it bumps, commits, and asks you to push again
- **Why the bump is at commit time, not push time**: git resolves the SHAs it will send
  *before* running pre-push, so a commit created inside a pre-push hook is never part of that
  push. Verified — a naive pre-push bump leaves the commit stranded locally.
- `scripts/bump-version.js` does the edit: `package.json` plus the two fields in
  `package-lock.json` that describe this package (root `version`, `packages[""].version`).
  Dependency versions are untouched.
- Hooks live in `.githooks/` (tracked) and are wired via `core.hooksPath`, set by the
  `prepare` npm script on install. One-time manual setup: `git config core.hooksPath .githooks`
- Bypass with `YTD_NO_BUMP=1 git commit ...` / `git commit --no-verify`
- Manual bump: `npm run bump`
- `.githooks/` and `scripts/` are outside electron-builder's `files` whitelist, so they never
  ship in the installer

### Theme ("Phosphor Terminal")
- All colors live in `:root` in `renderer/styles.css` — reskin = swap that block only
- Two alternate palettes (Cyber Magenta, Ion/Cold Steel) sit commented below `:root`
- Near-black neutral bases, single phosphor-green accent, sharp radii (3px/2px)
- `--on-accent` is the text color for anything sitting on `--accent` (bright accent = dark text)
- State tinting uses `color-mix(in srgb, var(--x) N%, transparent)` — never hardcoded rgba, so palette swaps stay total
- Mono font (`--font-mono`) on all machine data: paths, %, badges, buttons, labels, logs
- Ambient bg on `body` = radial accent glow + 40px grid; `body::before` = 3px scanline overlay at 0.03 opacity
- Queue item state is shown by a 2px colored left rail, not a card-wide tint
- `.status-downloading .progress-fill` animates 45° stripes; `.indeterminate` (merging) pulses amber

### Self-promo link
- "by Lance Petrisko" credit in the top-right of the header
- Click opens https://lancepetrisko.com/ via `shell.openExternal` (IPC: `open-external`)

## Commands
- `npm start` — run the app
- `npm run dev` — run with DevTools inspector
- `npm run build` — build NSIS installer to `dist/`
- `npm run build:portable` — build portable exe to `dist/`

## Releasing
1. Version is already bumped by the commit hooks — only edit `package.json` by hand for a
   minor/major bump
2. `npm run build`
3. Upload `dist/YT Downloader Setup x.x.x.exe` to GitHub Releases

## Dependencies
- System: yt-dlp (via pip or standalone), ffmpeg (via winget/choco/manual)
- npm: express, electron, electron-builder
