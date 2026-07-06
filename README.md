# Skald

A native Windows desktop client for [Audiobookshelf](https://www.audiobookshelf.org/), and a standalone server-free audiobook and podcast player.

Skald connects to your Audiobookshelf server for streaming, offline playback, library browsing, live progress sync, and server management for admins. It can also build and play local libraries straight from folders on your disk with no server at all, and subscribe to podcasts by RSS. You can access both your local files and your server libraries in a single, unified switcher. 

Built with **Tauri 2 + React 19 + TypeScript + Rust**, with audio handled natively by **LibVLC**. The user interface follows a bespoke design language called *Onyx*.

> **Status:** Working alpha. The app authenticates via password or API key, streams and plays audio, syncs progress live over Socket.IO, downloads for offline use, and features a deep settings menu. The target platform is **Windows 11 x64**. Linux is a future second-class target (see `linux-roadmap.md`).

---

## What's New in Version 1.0.3

The 1.0.3 release focuses on rounding out the local-only listening experience and improving the Microsoft Store package. 

- **Local Chapter Write-Back:** You can now edit chapters for single-file local audiobooks directly in the metadata editor.
- **Local-Only Polish:** We hid server-specific settings panes for users running without a server, fixed the greeting pane loading hang, and added an editable local display name.
- **Microsoft Store Fixes:** The MSIX package now correctly loads cover images by dynamically authorizing the asset protocol scope. We also fixed the taskbar icon styling and added a privacy policy.

---

## Features

- **Audiobookshelf Client:** Log in with a password or API key (tokens are safely stored in Windows Credential Manager). Browse your library by grid or list, explore 3D cover layouts, and sort by Series, Authors, Narrators, Collections, Playlists, Genres, or Publishers using advanced filters and scoped search.
- **Advanced Player:** Enjoy gapless playback for multi-file books. The player includes a waveform scrubber, chapter navigation, variable speed, a sleep timer, bookmarks, and an audiobook-tuned equalizer.
- **Live Sync:** Progress syncs over Socket.IO every 30 seconds. The app handles reconnect resyncs and cross-device progress reconciliation automatically.
- **Offline Mode:** Download books for offline playback. Your progress is saved locally and flushes back to the server the next time you connect.
- **Local Libraries (No Server):** Scan folders on your disk to build a catalog organized by Author, Series, and Title. The app matches metadata against Google Books, iTunes, or Open Library. You can play these files with catalog-backed progress, resume, and bookmarks. A background watcher auto-imports new files dropped in your staging folder.
- **Local Podcasts (No Server):** Subscribe to feeds via RSS or OPML. You can browse and download episodes, track your progress per episode, and use the auto-download scheduler.
- **Admin Tools:** Manage your library, server settings, notifications (Apprise), backups, and scheduled tasks. Admins also get access to a server log viewer, user management, an item metadata and chapter editor, cover management, custom metadata providers, and per-item public share links or RSS feeds.
- **Personalisation:** Choose your theme, accent color, and UI scale. You can also customize your keyboard shortcuts and enrich your library with Open Library reviews.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript (~5.8), Vite 7 |
| Desktop shell | Tauri 2 (`opener`, `dialog`, `global-shortcut`, `log` plugins) |
| Backend | Rust (edition 2021), `reqwest` + `tokio` |
| Audio | LibVLC via `vlc-rs` |
| Live sync | `rust_socketio` (Socket.IO) |
| Token storage | `keyring` mapping to Windows Credential Manager |
| Local catalog | SQLite via `rusqlite` |

---

## Building from Source

Skald standardizes on **pnpm**.

### Prerequisites

- [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install) (stable, MSVC toolchain)
- Tauri 2 prerequisites for Windows (WebView2 and Visual Studio Build Tools)

### Bundled Runtime (Not Committed)

Two directories are git-ignored and must be filled before a build. The `build.rs` script copies their contents next to the binary, and the bundler packages them as resources:

- `src-tauri/vlc-dist/`: Needs `libvlc.dll`, `libvlccore.dll`, `vlc-cache-gen.exe`, and the `plugins/` tree from a standard VLC installation.
- `src-tauri/bin/`: Needs `ffprobe.exe` (reads metadata and chapters) and `tone.exe` (writes metadata).

### Commands

```bash
pnpm install            # Install Node dependencies
pnpm tauri dev          # Run a development build with HMR
pnpm tauri build        # Create a production NSIS installer for Windows
pnpm exec tsc --noEmit  # Run a frontend type-check (safe while the app is running)
```

> **Note:** The `build.rs` script copies the VLC DLLs at build time and will fail with an OS "file in use" error if Skald is already running. Make sure to close the app before running `cargo` or `tauri build`.

---

## License

Skald is licensed under the **GNU General Public License v3.0**. See the [`LICENSE`](LICENSE) file for details.

## Acknowledgements & Trademarks

Skald is an unofficial, third-party client. It is not affiliated with, sponsored by, or endorsed by the Audiobookshelf project. "Audiobookshelf" is the name of that separate project, and it is used here only to describe compatibility in accordance with their [third-party app guidelines](https://audiobookshelf.org/docs/faq/app/). Skald uses its own name and icon, and it does not use the Audiobookshelf logo.
