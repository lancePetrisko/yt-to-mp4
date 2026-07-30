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
- Zero setup — yt-dlp and ffmpeg ship inside the installer
- Saves to your Downloads folder by default

## Install (end-user)

**Nothing else to install.** yt-dlp and ffmpeg ship inside the installer — no terminal, no Homebrew, no PATH setup.

**Windows:** download `YT Downloader Setup x.x.x.exe` from the [Releases](https://github.com/lancePetrisko/yt-to-mp4/releases) page, run it, pick an install directory, and launch **YT Downloader** from the Start Menu.

**macOS:** download the `.dmg` for your Mac from [Releases](https://github.com/lancePetrisko/yt-to-mp4/releases) — `arm64` for Apple Silicon (M1 and newer), `x64` for Intel. Open it and drag the app to Applications.

> **First launch on macOS:** the app isn't signed with an Apple Developer certificate, so macOS blocks it the first time. Right-click (or Control-click) the app → **Open** → **Open** in the dialog. Only needed once. Double-clicking normally just shows "damaged or can't be opened".

### If you already have yt-dlp/ffmpeg installed

That's fine — the app prefers its own bundled copies and ignores yours, so a broken or outdated system install can't break it. Resolution order for both tools:

1. Bundled copy inside the app
2. Whatever is on `PATH`
3. (yt-dlp only) `python -m yt_dlp`, for pip installs that aren't on `PATH`

The per-download log shows which one was used.

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

Running from source uses the same bundled binaries as the installers. Fetch them once:

```bash
npm run fetch-binaries
```

Without them the app falls back to a system yt-dlp/ffmpeg on `PATH`.

### Building the installers

The version bumps itself on commit (see below), so no manual edit is needed.

```bash
npm run build          # Windows NSIS installer
npm run build:portable # Windows portable .exe
npm run build:mac      # macOS .dmg, arm64 + x64
npm run build:all      # everything
```

Each script downloads the right yt-dlp/ffmpeg binaries into `build/bin/<platform>-<arch>/` first, then electron-builder copies them into the app as `resources/bin`. Downloads are cached; `npm run fetch-binaries -- --force` re-fetches.

Output lands in `dist/` (gitignored):

- `YT Downloader Setup x.x.x.exe`
- `YT Downloader x.x.x arm64.dmg` / `YT Downloader x.x.x x64.dmg`

> **Cross-building:** macOS `.dmg` files must be built on a Mac. The Windows installer cross-builds fine from macOS — electron-builder downloads its own Wine and NSIS automatically (verified).
>
> **Code signing:** neither target is signed. Windows shows a SmartScreen warning ("More info" → "Run anyway"); macOS requires the right-click → Open dance on first launch. Removing those warnings means an Apple Developer account ($99/yr, plus notarization) and a Windows code-signing certificate.

### Automatic versioning

Git hooks bump the patch version once per push, so every build has a distinct version. Set up on `npm install`; manually it's `git config core.hooksPath .githooks`. Bypass with `git commit --no-verify`.

## Licensing

YTDown's own code is MIT (see `LICENSE.txt`). The installers also bundle FFmpeg (GPL-3.0-or-later) and yt-dlp (Unlicense). Both are run as separate executables and are never linked against, so YTDown itself stays MIT.

Publishing a release means shipping `THIRD-PARTY-NOTICES.md` alongside it — that file carries the FFmpeg source offer the GPL requires. `npm run fetch-binaries` refuses any FFmpeg build compiled with `--enable-nonfree`, since those cannot be redistributed at all.

## Stack

- **Electron** — desktop window
- **Node.js + Express** — local backend on port 3131
- **Vanilla JS** — no frontend frameworks
- **yt-dlp** — video downloading (YouTube, Twitch, Kick)
- **ffmpeg** — merging video + audio streams, re-encoding audio to AAC so the MP4 plays in Windows Media Player and QuickTime

## Project Structure

```
yt-to-mp4/
├── main.js               # Electron main process, boots Express
├── preload.js            # contextBridge IPC (window.electronAPI)
├── package.json
├── .githooks/            # Auto version bump on commit/push
│   ├── pre-commit
│   └── pre-push
├── scripts/
│   ├── bump-version.js   # Patch bump, used by the hooks
│   └── fetch-binaries.js # Downloads yt-dlp + ffmpeg for bundling
├── build/
│   ├── icon.ico          # App icon (Windows installer)
│   ├── icon.icns         # App icon (macOS)
│   └── bin/              # Fetched binaries, gitignored
│       ├── win32-x64/
│       ├── darwin-arm64/
│       └── darwin-x64/
├── renderer/
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── server/
    └── downloader.js     # yt-dlp/ffmpeg wrapper + Express routes
```

## Logs

Each download writes a timestamped log capturing the full yt-dlp command, stdout, stderr, and exit code. Click the **Logs** button on any queue item to view it in-app.

- **Development:** `logs/<id>.log` (project root)
- **Installed app (Windows):** `%APPDATA%/yt-downloader/logs/<id>.log`
- **Installed app (macOS):** `~/Library/Application Support/yt-downloader/logs/<id>.log`
