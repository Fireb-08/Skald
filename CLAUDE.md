# Skald — Claude Code Project Guide

This file informs Claude Code about the conventions, structure, and authoritative references for the Skald Tauri rewrite. Read it at the start of every session and before producing any code.

---

## What this project is

Skald is a native desktop client for Audiobookshelf servers. The active work is a **Tauri + React + TypeScript + Rust** rewrite of an earlier Avalonia/C# implementation. The UI follows the "Onyx" design direction provided as a high-fidelity React/JSX prototype in `design-handoff/`.

---

## Workflow

The user follows an incremental, one-step-at-a-time pattern:

1. A planning assistant (Claude in the chat UI) issues a single, scoped instruction.
2. The user pastes that instruction into Claude Code.
3. Claude Code performs the file changes.
4. The user runs the verification step (typically `pnpm tauri dev` or `pnpm tauri build`).
5. The user reports results back to the planning assistant.

**Rules for Claude Code:**

- Stay within the scope of the current instruction. Do **not** anticipate future steps.
- If a referenced file does not exist, create it. Do **not** refactor unrelated files.
- Surface ambiguities or apparent contradictions to the user rather than guessing.
- The full step-by-step plan is in `ROADMAP.md` (47 steps across 7 phases). Do not skip phases or merge steps unless asked.

---

## Authoritative references

### Audiobookshelf — backend behavior

The Audiobookshelf project is the source of truth for endpoint paths, request/response shapes, and protocol behavior. When the official API documentation is ambiguous, read the matching controller source code.

- **GitHub repository:** https://github.com/advplyr/audiobookshelf
  - `server/controllers/` — HTTP endpoint implementations
  - `server/objects/` — JSON model shapes
  - `server/managers/` — business logic (session, library, user)
  - `server/routers/` — route registration; confirms exact URL paths
  - `client/store/` — how the official web client consumes the API (useful for verifying end-to-end behavior)
- **API documentation:** https://api.audiobookshelf.org
- **Issue tracker:** https://github.com/advplyr/audiobookshelf/issues — search before assuming a behavior is undocumented (issue #724 documents session-sync semantics, for example)

Verify endpoint paths, query parameters, and response shapes against these sources **before** writing models or HTTP calls. Do not infer endpoint behavior from prior assumptions.

### Design handoff — UI behavior

The `design-handoff/` folder holds the original React/JSX prototype. **This is the visual goal.** When implementing any UI feature, open the corresponding file and match its layout, copy, spacing, and interaction behavior.

| File | Defines |
|---|---|
| `design-handoff/source/app/library.jsx` | Library screen, Focus card, popovers, shelf header, ShelfList |
| `design-handoff/source/app/player.jsx` | Player, waveform, transport, sleep timer, bookmark-this-moment |
| `design-handoff/source/app/browse.jsx` | Series, Authors, Narrators, Collections views + Home dashboard |
| `design-handoff/source/app/settings.jsx` | All settings sections |
| `design-handoff/source/app/chrome.jsx` | OnyxWash, Titlebar, Glass, TopNav, VolumeControl, DeviceSelector |
| `design-handoff/source/app/state.jsx` | Theme palettes (`ONYX_DARK_BASE`, `ONYX_FOLIO_BASE`), tokens, mock data |
| `design-handoff/source/app/icons.jsx` | Icon set + Waveform component |
| `design-handoff/source/books.jsx` | Cover placeholder system (six typographic templates) |
| `design-handoff/README.md` | Token tables, spacing, copy, interaction descriptions |

Open `design-handoff/source/Skald_App.html` in a browser to see the prototype run live. Confirm visual fidelity against it after each UI step. **Do not modify files inside `design-handoff/`; it is read-only reference material.**

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend framework | React 18 (function components, hooks) |
| Frontend language | TypeScript |
| Frontend build tool | Vite |
| Desktop shell | Tauri 2.x |
| Backend language | Rust |
| HTTP client | `reqwest` + `tokio` |
| Audio engine | LibVLC via `vlc-rs` |
| Token storage | `keyring` crate (Windows Credential Manager) |
| Settings persistence | WebView `localStorage` |
| Theme implementation | CSS custom properties on `:root` |
| Target platform (initial) | Windows 11 x64 |

---

## Project structure (target)

```
Skald-Tauri/
├── src/                        # React/TypeScript frontend
│   ├── App.tsx
│   ├── index.css               # Global rules + CSS custom properties on :root
│   ├── assets/
│   │   └── fonts/              # Vendored Source Serif Pro, Inter, JetBrains Mono
│   ├── api/
│   │   └── abs.ts              # Tauri command bindings (typed)
│   ├── state/
│   │   ├── onyx.ts             # useOnyxState, helpers, mock data, types
│   │   └── theme.ts            # applyTheme, setAccentColor, palettes
│   ├── components/
│   │   ├── chrome/             # OnyxWash, Titlebar, Glass, TopNav, ...
│   │   ├── shelf/              # Shelf-internal components
│   │   │   └── tabs/           # SeriesView, AuthorsView, NarratorsView, CollectionsView
│   │   ├── settings/           # Settings section panes
│   │   ├── Cover.tsx
│   │   ├── Icon.tsx
│   │   ├── Waveform.tsx
│   │   ├── FocusPanel.tsx
│   │   └── PickItUp.tsx
│   └── screens/
│       ├── Library.tsx
│       ├── Player.tsx
│       ├── Settings.tsx
│       └── Home.tsx
├── src-tauri/                  # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── commands.rs         # #[tauri::command] functions
│       ├── api.rs              # Audiobookshelf HTTP client
│       ├── auth.rs             # Token persistence via keyring
│       ├── audio.rs            # LibVLC playback via vlc-rs
│       ├── models.rs           # Serde structs
│       └── cover_cache.rs      # On-disk cover image cache
├── design-handoff/             # Original React/JSX prototype (read-only)
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── CLAUDE.md                   # This file
└── ROADMAP.md                  # Step-by-step work plan (47 steps, 7 phases)
```

---

## Conventions

### TypeScript

- Components are function components only. No class components.
- Component files are `.tsx`; non-component utilities are `.ts`.
- Props use a typed `interface` named `{Component}Props`.
- Prefer `interface` for object shapes that might be extended; `type` for unions and aliases.
- Hooks return typed objects, not unlabeled tuples beyond the standard `useState` shape.

### Imports and exports

- ES module `import`/`export` only. **No `window.X = X;` assignments.** The prototype's global-export pattern does not carry forward.
- One default export per component file; named exports for sub-components, types, and helpers.
- Absolute imports from `src/` are preferred over deep relative paths. Configure path aliases in `tsconfig.json` and `vite.config.ts`.

### Styling

- Components use inline `style={{ ... }}` objects. **No CSS Modules, no Tailwind, no styled-components.**
- All token values reference CSS custom properties: `style={{ background: 'var(--onyx-bg)' }}`.
- Pseudo-class hover and focus rules live in `src/index.css` via the `.onyx-tile` / `.onyx-row` / `.onyx-poster` / `.onyx-winbtn` classes.
- Book covers are **square (1:1)**.

### State management

- Top-level shared state lives in `useOnyxState()` in `src/state/onyx.ts`.
- Per-component UI state (popover open, drawer toggled, hover, etc.) stays local to the component.
- User preferences persist via WebView `localStorage` with the `onyx.*` key prefix used by the prototype. **Preserve these keys verbatim** so the prototype's localStorage values remain compatible.
- Theme changes go through `applyTheme(theme, accentHex)` in `src/state/theme.ts`. That function writes to `document.documentElement.style`, setting CSS custom properties. **Do not introduce a separate mutable JS object for the palette.** Components read theme values via `var(--onyx-…)` only.

### Rust backend

- No DI container. Manual constructor wiring, matching the prior project's pattern.
- Models use `#[derive(Deserialize, Serialize)]` with `#[serde(rename_all = "camelCase")]`.
- Fields whose JSON representation varies between minified and expanded responses (e.g., `author`) use `#[serde(untagged)]` enums.
- Async via `tokio`. Periodic timers via `tokio::time::interval`.
- Tauri commands declared with `#[tauri::command]` and registered in `main.rs` via the `invoke_handler!` macro.
- The audio engine instance lives in a single `Arc<Mutex<VlcAudio>>` shared across commands via Tauri's managed state (`.manage(...)`).

---

## Critical lessons from the prior Avalonia project

Apply these without rediscovering them. Each was a multi-hour debugging session in the previous codebase.

1. **Audiobookshelf `/login` is at the server root, not under `/api/`.** Set the HTTP client's base URL to the server root (e.g., `http://192.168.1.238:13378/`); use the relative path `login` for the auth endpoint and `api/{rest}` for everything else.

2. **LibVLC HTTP headers do not reliably forward.** The `:http-header=` media option fails to authenticate against protected media URLs in many LibVLC builds. Use the Audiobookshelf-documented **token-in-URL** pattern instead: append `?token={JWT}` to media URLs.

3. **Periodic 30-second session sync is required** for progress to persist correctly. Validated against Audiobookshelf GitHub issue #724. Use `tokio::time::interval(Duration::from_secs(30))`.

4. **Sync-before-close shutdown** is required to avoid losing the final ~30 seconds of progress. Run the final session sync inside a `tokio::task::spawn_blocking` (or equivalent) wrapper with a timeout, so the runtime can exit cleanly even if the sync hangs. Triggered by Tauri's `RunEvent::ExitRequested`.

5. **The `author` field's JSON shape varies.** Depending on the endpoint and whether the response is minified or expanded, `author` can be a string, an object, or an array of objects. Use `#[serde(untagged)]` enums; do not assume a single shape.

6. **`/api/users/{id}/listening-stats` needs the user's actual ID,** not the literal string `"me"`. Retain `userId` from the login response and use it for that endpoint specifically. The `/api/me` endpoint is the exception that accepts `"me"`.

7. **Always verify endpoint paths against the Audiobookshelf GitHub source.** The official documentation site occasionally diverges from current server behavior. The `server/controllers/` directory of the GitHub repo is authoritative.

---

## Build and run

```
pnpm install              # install Node dependencies
pnpm tauri dev            # development build with HMR
pnpm tauri build          # production installer (Windows MSI + NSIS)
```

Verification at the end of each roadmap step is typically `pnpm tauri dev` followed by a manual UI check.

---

## What not to do

- Do **not** introduce a DI container or service locator.
- Do **not** introduce Howler.js, the Web Audio API, an `<audio>` element, or any other frontend audio engine. Audio is handled exclusively in Rust via LibVLC.
- Do **not** introduce a CSS framework (Tailwind, CSS Modules, styled-components, Emotion, etc.).
- Do **not** create a mutable JavaScript object for theme values. The theme lives in CSS custom properties on `:root`.
- Do **not** modify files inside `design-handoff/`. That folder is read-only reference material.
- Do **not** invent endpoint paths, model fields, or response shapes. Verify against the Audiobookshelf GitHub source.
- Do **not** skip the verification step at the end of each roadmap instruction.
- Do **not** combine multiple roadmap steps into one change unless explicitly asked.

---

## When unsure

- **UI behavior or appearance:** open the corresponding file in `design-handoff/` and match it.
- **Audiobookshelf API behavior:** read the relevant controller in https://github.com/advplyr/audiobookshelf.
- **Anything else:** surface the question to the user and stop. Do not guess.
