# Third-Party Notices

YTDown is distributed under the MIT license (see `LICENSE.txt`). The installers also
bundle two third-party programs, which keep their own licenses. This file is what
accompanies a release to satisfy those licenses.

YTDown runs both as **separate executables** (via `child_process.spawn`) and does not
link against their libraries. It is not a derivative work of either, so YTDown's own
source stays MIT-licensed.

---

## FFmpeg

- **Homepage:** https://ffmpeg.org
- **License:** GNU General Public License, version 3 or later (GPL-3.0-or-later)
- **Version bundled:** FFmpeg 8.1

The exact `./configure` line for each bundled build is recorded in
`build/bin/<platform>-<arch>/BUILD-INFO.txt`, which is also shipped inside the app at
`resources/bin/BUILD-INFO.txt`.

### Where the builds come from

| Platform | Source |
|---|---|
| Windows x64 | https://github.com/BtbN/FFmpeg-Builds (`ffmpeg-n8.1-latest-win64-gpl-8.1.zip`) |
| macOS arm64 / x64 | https://ffmpeg.martin-riedl.de (macOS `release` builds) |

### Written offer for source code

As required by GPL-3.0 section 6, the complete corresponding source code for the
bundled FFmpeg builds is available:

- FFmpeg 8.1 source: https://github.com/FFmpeg/FFmpeg/tree/release/8.1
- Windows build scripts: https://github.com/BtbN/FFmpeg-Builds
- macOS build scripts: https://github.com/mri1/ffmpeg-build-script (as published at
  https://ffmpeg.martin-riedl.de)

For a copy of the source on physical media, open an issue on this repository.

A full copy of the GPL v3 text must be included with any binary release:
https://www.gnu.org/licenses/gpl-3.0.txt

### Important: never bundle a `--enable-nonfree` build

FFmpeg binaries compiled with `--enable-nonfree` combine components whose licenses are
mutually incompatible, and **cannot be redistributed by anyone**. Several popular
prebuilt macOS FFmpeg distributions (evermeet.cx, and the `ffmpeg-static` npm release
binaries that wrap them) are built this way.

`scripts/fetch-binaries.js` reads the configure line out of every downloaded FFmpeg
binary and fails the build if `--enable-nonfree` is present, so an unpublishable build
cannot silently end up in an installer.

---

## yt-dlp

- **Homepage:** https://github.com/yt-dlp/yt-dlp
- **License:** The Unlicense (public domain)
- **Version bundled:** see `resources/bin/BUILD-INFO.txt`

The Unlicense places the work in the public domain and imposes no redistribution
conditions. It is listed here for completeness.

---

## Release checklist

When publishing to GitHub Releases:

1. Confirm the build printed `license: ... (no --enable-nonfree)` for every ffmpeg binary
2. Attach this file to the release, or link to it
3. Include `LICENSE.txt` (MIT, YTDown) and a copy of the GPL v3 text
4. Keep the FFmpeg source links above reachable for as long as the binaries are offered
