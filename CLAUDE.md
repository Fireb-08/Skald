# Skald — Claude Code Project Guide

This file informs Claude Code about the conventions, structure, and authoritative references for **Skald**, a native desktop client for Audiobookshelf. Read it at the start of every session and before producing any code.

> **Note on file location:** This `CLAUDE.md` lives at the **project root** (`Skald/CLAUDE.md`). Sessions are frequently launched with the working directory set to `src-tauri/` (the Rust backend), in which case the harness does **not** auto-load this file — read it manually.

---

## What this project is

Skald is a **native Windows desktop client for Audiobookshelf** servers, built with **Tauri 2 + React 19 + TypeScript + Rust**. It connects to a user's ABS server for streaming and offline playback, library browsing, progress sync, and (admin) server management. The UI follows the bespoke **"Onyx"** design language.

**Status: working alpha.** The original 7-phase build (scaffold → UI shell → backend → wiring → login → packaging) is complete. The app launches, authenticates (password or API key), streams and plays audio via LibVLC, syncs progress live over Socket.IO, downloads for offline use, and ships a broad settings surface. Active work is now **incremental feature additions** that close gaps against the ABS web client (see *Feature status* below).

---

## Workflow

Work proceeds one scoped feature at a time. A planning assistant (Claude in the chat UI) and the user agree on a feature; Claude Code defines it, produces a short roadmap, then implements in phases.

**Rules for Claude Code:**

- **Verify ABS API behavior against the GitHub source before writing any model or HTTP call.** Do not infer endpoint paths, methods, or response shapes from memory. See *Authoritative references*.
- Stay within the scope of the current instruction. Surface ambiguities rather than guessing.
- If a referenced file does not exist, create it. Do not refactor unrelated files.
- **Document generated code** — comments should explain *why*, matching the density of the surrounding code.
- **Add diagnostic logging when building a feature** (`println!` in Rust commands, `console.log` in the frontend) so the user can validate behavior during `pnpm tauri dev`. Keep it in place for the whole roadmap, not just one phase. The established rhythm: build with diagnostics → user validates each phase → commit → (only after the full roadmap is complete) remove diagnostics → commit. See *Notes*.
- **Commit to local git between phases.** Use `pnpm` (not npm) — the project standardizes on it.

Feature roadmaps (current and historical) are kept in the user's Obsidian vault at `Vault/Skald/` — completed ones are marked "Complete" and are a reliable reference for how an existing feature works. The vault is git-ignored.

---

## Authoritative references

### Audiobookshelf — backend behavior

The Audiobookshelf project is the **source of truth** for endpoint paths, request/response shapes, and protocol behavior. When the API docs are ambiguous or stale, read the matching controller/router source.

- **Server repo:** https://github.com/advplyr/audiobookshelf
  - `server/routers/` — route registration; confirms exact URL paths **and HTTP methods**
  - `server/controllers/` — endpoint implementations (request body, response, permission checks)
  - `server/objects/` — JSON model shapes
  - `server/managers/` — business logic (session, library, notifications)
  - `server/utils/` — supporting data (e.g. `notifications.js` holds the notification event catalog)
- **Mobile app repo (useful client-behavior reference):** https://github.com/advplyr/audiobookshelf-app
- **API docs:** https://api.audiobookshelf.org
- **Issues:** https://github.com/advplyr/audiobookshelf/issues — search before assuming a behavior is undocumented (issue #724 documents session-sync semantics).

### Design handoff — UI behavior

`design-handoff/` holds the original React/JSX prototype — the **visual reference** for the Onyx look. Match its layout, copy, spacing, and interaction behavior when touching a screen it covers. Many screens have since been built out well beyond the prototype; when a feature has no prototype counterpart, follow the established Onyx conventions in the existing components. **`design-handoff/` is read-only — do not modify it.**

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend framework | React 19 (function components, hooks) |
| Frontend language | TypeScript ~5.8 |
| Frontend build tool | Vite 7 |
| List virtualization | `@tanstack/react-virtual` |
| Desktop shell | Tauri 2.x (`protocol-asset`, `devtools` features) |
| Tauri plugins | `opener`, `dialog`, `global-shortcut` |
| Backend language | Rust (edition 2021) |
| HTTP client | `reqwest` 0.12 (`json`, `rustls-tls`, `stream`) + `tokio` (full) |
| Audio engine | LibVLC via `vlc-rs` 0.3 (VLC runtime bundled under `src-tauri/vlc-dist/`) |
| Live sync | `rust_socketio` 0.6 (async) — Socket.IO transport |
| Token storage | `keyring` 3 (`windows-native`) → Windows Credential Manager |
| Downloads | `reqwest` streaming + `zip` (deflate) + `tokio-util` CancellationToken |
| Settings persistence | WebView `localStorage` (`onyx.*` key prefix) |
| Theme implementation | CSS custom properties on `:root` |
| Timestamps | `chrono` |
| Target platform | Windows 11 x64 |

---

## Project structure (current)

```
Skald/
├── src/                          # React/TypeScript frontend
│   ├── App.tsx                   # Screen-switch root composition
│   ├── index.css                 # Global rules + :root CSS custom properties (Onyx tokens)
│   ├── api/
│   │   ├── abs.ts                # Typed Tauri command bindings (the main bridge)
│   │   ├── eq.ts                 # Equalizer command bindings
│   │   ├── playbook.ts           # Playback helpers
│   │   └── reviewCache.ts        # Open Library review/rating cache
│   ├── state/
│   │   ├── onyx.ts               # useOnyxState — top-level shared state, types, helpers
│   │   └── theme.ts              # applyTheme, setAccentColor, palettes
│   ├── hooks/  lib/              # Shared hooks and utilities
│   ├── components/
│   │   ├── chrome/               # OnyxWash, Titlebar, Glass, TopNav, VolumeControl, DeviceSelector
│   │   ├── shelf/                # Library shelf + tabs/ (Series, Authors, Narrators, Collections, Playlists)
│   │   ├── settings/             # One pane per settings section (see Feature status)
│   │   ├── player/               # MiniPlayer
│   │   ├── greeting/             # GreetingPane
│   │   ├── downloads/            # DownloadProgressToast
│   │   ├── ui/                   # ConfirmDialog, Toast
│   │   ├── Cover.tsx Icon.tsx Waveform.tsx FocusPanel.tsx PickItUp.tsx
│   │   ├── MatchModal.tsx CollectionPicker.tsx PlaylistPicker.tsx ContextMenu.tsx
│   └── screens/
│       ├── Library.tsx Player.tsx Settings.tsx Home.tsx Login.tsx
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml  tauri.conf.json
│   ├── vlc-dist/                 # Bundled LibVLC DLLs + plugins (copied by build.rs)
│   └── src/
│       ├── lib.rs                # run() — window setup + invoke_handler! registration + shutdown sync
│       ├── main.rs               # Thin entry point → lib::run()
│       ├── commands.rs           # #[tauri::command] functions
│       ├── api.rs                # Audiobookshelf HTTP client (AbsClient)
│       ├── models.rs             # Serde structs (camelCase)
│       ├── auth.rs               # Token persistence via keyring
│       ├── audio.rs              # LibVLC playback via vlc-rs
│       ├── eq.rs                 # Equalizer (band/preset state)
│       ├── session.rs            # SessionManager — playback session + periodic sync
│       ├── socket.rs             # Socket.IO live-sync transport
│       ├── downloads.rs          # Offline download registry + offline progress queue
│       └── cover_cache.rs        # On-disk cover image cache
├── design-handoff/               # Original React/JSX prototype (READ-ONLY reference)
├── Vault/                        # Obsidian vault: feature roadmaps (git-ignored)
├── package.json  tsconfig.json  vite.config.ts
└── CLAUDE.md                     # This file
```

---

## Conventions

### TypeScript / React

- Function components only. Component files are `.tsx`; non-component utilities are `.ts`.
- Props use a typed `interface` named `{Component}Props`.
- One default export per component file; named exports for sub-components, types, and helpers.
- ES module `import`/`export` only. **No `window.X = X;` global assignments.**

### Styling

- Components use inline `style={{ ... }}` objects. **No CSS frameworks** (Tailwind, CSS Modules, styled-components, Emotion).
- All token values reference CSS custom properties, which are **kebab-case**: `var(--onyx-bg)`, `var(--onyx-text-dim)`, `var(--onyx-glass-edge)`, `var(--onyx-accent)`, etc. (The prototype's camelCase token names were normalized to kebab-case during the rewrite — match the real names in `src/index.css`.)
- Pseudo-class hover/focus rules live in `src/index.css` (`.onyx-tile` / `.onyx-row` / `.onyx-poster` / `.onyx-winbtn`).
- Book covers are **square (1:1)**.
- Shared settings primitives (`SectionHead`, `Row`, `Toggle`, `MONO`) live in `src/components/settings/shared.tsx` — reuse them when building a new settings pane.

### State management

- Top-level shared state lives in `useOnyxState()` (`src/state/onyx.ts`). Per-component UI state stays local.
- User preferences persist via `localStorage` with the `onyx.*` prefix — **preserve these keys verbatim**.
- Theme changes go through `applyTheme(theme, accentHex)` (`src/state/theme.ts`), which writes CSS custom properties to `document.documentElement.style`. **Do not introduce a separate mutable JS palette object.** Components read theme values via `var(--onyx-…)` only.

### Rust backend

- No DI container. Manual constructor wiring.
- Models use `#[derive(Serialize, Deserialize)]` with `#[serde(rename_all = "camelCase")]`. Optional/variable fields use `#[serde(default)]` and `skip_serializing_if`. Use `#[serde(untagged)]` enums for fields whose JSON shape varies (e.g. `author`). For JSON keys that are Rust keywords (e.g. `type`), use `#[serde(rename = "type")] pub kind: String`.
- Async via `tokio`; periodic timers via `tokio::time::interval`.
- **The HTTP client pattern:** `AbsClient::new(server_url).with_token(token)` then call a method. Commands load the token via `auth::load_token()?`.
- **Tauri commands** are declared with `#[tauri::command]` in `commands.rs` and registered in **`lib.rs`** via `tauri::generate_handler!` (inside `run()`) — *not* `main.rs`.
- The audio session lives in `Arc<Mutex<SessionManager>>` shared via Tauri managed state (`.manage(...)`).

---

## Critical lessons

Apply these without rediscovering them. Each was a multi-hour debugging session.

### Audiobookshelf API

1. **`/login` is at the server root, not under `/api/`.** Base URL is the server root; use `login` for auth and `api/{rest}` for everything else.
2. **`/api/authorize` is a `POST` route** (not GET — a GET returns 404). Its response payload includes `serverSettings`, `user`, `userDefaultLibraryId`, `ereaderDevices`. The two-step login is: `POST /login` → `POST /api/authorize` (to obtain a signed JWT the socket middleware accepts and to capture server settings).
3. **Server settings have no standalone GET endpoint.** They only arrive in the login/authorize payload. To populate the admin Server Settings panel on an already-logged-in launch, re-fetch via `POST /api/authorize`. (Contrast: **notifications** *do* have `GET /api/notifications`.)
4. **`/api/users/{id}/listening-stats` needs the real user ID,** not the literal `"me"`. `/api/me` is the exception that accepts `"me"`.
5. **The `author` field's JSON shape varies** (string vs object vs array) by endpoint and minified-vs-expanded response. Use `#[serde(untagged)]` enums.
6. **Always verify endpoint paths and HTTP methods against the GitHub `server/routers/` source.** The docs site occasionally diverges from current server behavior.

### Audio / LibVLC

7. **LibVLC HTTP headers do not reliably forward.** Use the ABS token-in-URL pattern (`?token={JWT}`), not `:http-header=`.
8. **Periodic 30-second session sync is required** for progress to persist (validated against issue #724). Use `tokio::time::interval(Duration::from_secs(30))`.
9. **Sync-before-close on shutdown** is required to avoid losing the final ~30s of progress. Run the final sync with a timeout inside the `RunEvent::ExitRequested` handler (see `lib.rs`).
10. **`VLC_PLUGIN_PATH` must be set to the bundled `plugins/` dir before the first `Instance::new()`.** Done in the Tauri `setup()` hook. LibVLC (`libvlc.dll`) is loaded lazily on the first playback call, not at startup.
11. **`build.rs` copies the VLC DLLs and will fail with an OS "file in use" (error 32) if the app is already running** — this aborts the build *before* Rust type-checking, so `cargo check` can't validate code while `tauri dev` is live. To verify backend compiles, stop the running app first, or rely on the user's `pnpm tauri dev` result.

### Tauri / Windows

12. **The main window must be created in `setup()` with `.disable_drag_drop_handler()`.** Without it, WebView2 registers a native IDropTarget that intercepts all drag events and forces the OS "no-drop" cursor on internal DOM drags. (Tauri 2.x removed `fileDropEnabled` from `tauri.conf.json` — it's builder-only.)
13. **Git is case-insensitive on Windows.** An unanchored `.gitignore` rule like `Fonts/` also matches `src/assets/fonts/`. Anchor root-only rules with a leading slash (`/Fonts/`).

---

## Build and run

```
pnpm install              # install Node dependencies
pnpm tauri dev            # development build with HMR
pnpm tauri build          # production installer (Windows MSI + NSIS)
npx tsc --noEmit          # frontend type-check (does not touch the VLC DLL; safe while app runs)
```

Verification is typically `pnpm tauri dev` followed by a manual UI check and a review of the diagnostic log output.

---

## Feature status (high level)

**Built and working:** password + API-key login, keyring token storage, library browsing (grid/list, Series/Authors/Narrators/Collections/Playlists tabs, 3D CoverFan/Mosaic layouts), Focus card + Pick-it-up, player (waveform, chapters, speed, sleep timer, bookmarks), live progress sync over Socket.IO with reconnect resync, offline downloads + local playback + offline progress queue, audio device selection, equalizer (bands + audiobook-focused presets), collections, playlists, library management (admin), server settings (admin), notification settings (Apprise — admin), backup management (admin), scheduled-tasks monitor (admin — live via socket task events), server logs viewer (admin — snapshot + live socket tail), item metadata + chapter editor (admin — single-item; batch deferred), cover management (admin — finder/upload/remove), listening sessions, user management (admin), customizable keyboard shortcuts, Open Library review enrichment, theme/accent/scale switching. **All Section 8 admin items of the gap analysis are now built.**

**Settings sections** (`src/components/settings/`): Account, Server (the live-sync toggle from `SyncSection` and the admin-only `ServerSettingsSection` are both embedded here, not separate nav entries), Notifications (admin), Backups (admin), ScheduledTasks (admin), Logs (admin), Playback, Audio, Library, Libraries (admin), Downloads, ListeningSessions, Integrations, Appearance, Keyboard, About.

**Note — socket-forwarded events:** `socket.rs` forwards several ABS socket events as Tauri events. Tasks: `task_started`/`task_finished` (→ `task-started`/`task-finished`), with an always-mounted listener in `onyx.ts` maintaining `st.tasks` (backups are **not** tasks — they report via `backup_applied` — so they never appear in `GET /api/tasks`). Logs: the ABS `log` event (→ `server-log`) is forwarded only after the client registers as a log listener via `set_log_listener(level)` (admin-enforced); `start_log_stream`/`stop_log_stream` commands emit `set_log_listener`/`remove_log_listener` on the live-sync socket. The Logs panel listens per-mount (logs are a "look now", high-volume view), unlike tasks which buffer globally.

**Known gaps / candidate next work** (vs. ABS web client): batch metadata edit + Manage Tracks (deferred parts of cluster A), metadata providers (C), podcast libraries (E), ebook reader (F), sharing/RSS feeds (G), OIDC SSO (H). The full gap analysis (with the A–N roadmap clusters) is in `Vault/Skald/`. Completed feature roadmaps (Notification Settings, Backup Management, Scheduled Tasks, Server Logs Viewer, Metadata Editing, Cover Management) are archived in `Vault/Skald/` with their Troubleshooting sections; every pending cluster (A–N) has a roadmap there.

---

## What not to do

- Do **not** introduce a DI container or service locator.
- Do **not** introduce Howler.js, the Web Audio API, an `<audio>` element, or any other frontend audio engine. Audio is Rust/LibVLC only.
- Do **not** introduce a CSS framework.
- Do **not** create a mutable JavaScript object for theme values — the theme lives in CSS custom properties on `:root`.
- Do **not** modify files inside `design-handoff/`.
- Do **not** invent endpoint paths, methods, model fields, or response shapes. Verify against the ABS GitHub source.
- Do **not** use npm — use `pnpm`.
- Do **not** skip the verification step at the end of a feature.

---

## Notes

- **Ensure created code is appropriately commented.** Comments should explain *why*, matching the density and style of the surrounding code.
- **Ensure that new features are accompanied by appropriate diagnostic code** (`println!` in Rust commands, `console.log` in the frontend) for ease of troubleshooting and validation.
- **Diagnostic code should only be removed once the current roadmap has been completed** — not after a single phase. Keep it in place across the whole feature build so the user can validate end-to-end, then strip it in a final cleanup pass and commit.
- **Diagnostic code potential outputs should be documented** — To ease troubleshooting, ensure that all diagnostic code has it's potential output logged at the bottom of a troubleshooting section that should be created whenever a roadmap is implemented. Ensure this section also contains what diagnostics were added to troubleshoot incase we need to return and troubleshoot in the future.


---

## When unsure

- **UI behavior or appearance:** open the corresponding file in `design-handoff/`, or follow the conventions in the existing Onyx components.
- **Audiobookshelf API behavior:** read the relevant router + controller in https://github.com/advplyr/audiobookshelf.
- **An existing Skald feature's design:** check the matching "Complete" roadmap in `Vault/Skald/`.
- **Anything else:** surface the question to the user and stop. Do not guess.
