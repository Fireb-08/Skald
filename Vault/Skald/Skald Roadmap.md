## Skald Tauri rewrite — comprehensive roadmap

### Architecture summary

| Decision                  | Choice                                                   |
| ------------------------- | -------------------------------------------------------- |
| Frontend stack            | Vite + React + TypeScript (Tier 2)                       |
| Theme implementation      | CSS custom properties on `:root` (Option B)              |
| Backend language          | Rust                                                     |
| Backend audio engine      | LibVLC via `vlc-rs`                                      |
| HTTP client               | `reqwest` + `tokio`                                      |
| Token persistence         | Windows Credential Manager via `keyring` crate           |
| Settings persistence      | WebView `localStorage` (matches the prototype's pattern) |
| Target platform (initial) | Windows 11 x64                                           |
| API reference             | Audiobookshelf GitHub — `https://api.audiobookshelf.org` |

**Total steps:** 47, across 7 phases.

---

### Phase 1 — Toolchain and project scaffold

End-of-phase deliverable: an empty Tauri + React + TypeScript app that launches on `pnpm tauri dev`, committed to a fresh Git repository.

- **Step 1.** Install Rust toolchain via `rustup`. Install Tauri prerequisites for Windows: Visual Studio Build Tools (C++ workload), WebView2 runtime. Verify with `cargo --version` and `rustc --version`.
- **Step 2.** Install Node LTS and pnpm. Verify with `node --version` and `pnpm --version`.
- **Step 3.** Create a fresh Tauri + React + TypeScript project via `pnpm create tauri-app` in a `Skald-Tauri` folder. Verify `pnpm tauri dev` launches the default app.
- **Step 4.** Configure project metadata: `tauri.conf.json` (productName, identifier, version, window 1280×800 default, 1024×640 min, dark background, title "Skald"); `package.json` (name, description); `src-tauri/Cargo.toml` (name, version, description).
- **Step 5.** Initialize a Git repository, add a `.gitignore` covering Node + Rust + IDE artifacts, commit the baseline. Tag `v0.0.0-scaffold`.

---

### Phase 2 — UI shell from the handoff bundle, mock data

End-of-phase deliverable: the full prototype navigable inside the Tauri window — both themes, accent picker, all shelf tabs, sleep timer, all popovers, all settings — indistinguishable from the browser version.

#### Theme and CSS foundation

- **Step 6.** Vendor the three Google Fonts (Source Serif Pro, Inter, JetBrains Mono) into `src/assets/fonts/`. Add `@font-face` declarations to `src/index.css`. No CDN references.
- **Step 7.** Set up `src/index.css` with the global rules from `Skald App.html`: CSS custom properties on `:root` for the full token palette (`--onyx-bg`, `--onyx-text`, `--onyx-textDim`, `--onyx-textMute`, `--onyx-panel`, `--onyx-panel2`, `--onyx-line`, `--onyx-glass`, `--onyx-glassStrong`, `--onyx-glassEdge`, `--onyx-accent`, `--onyx-accentBright`, `--onyx-accentDim`, `--onyx-accentEdge`, plus the RGB triplets `--onyx-accent-r/g/b`). Add the scrollbar styling, `:focus-visible` outlines, `::selection`, and the `.onyx-tile` / `.onyx-winbtn` / `.onyx-row` / `.onyx-poster` hover classes — all referencing the CSS custom properties.
- **Step 8.** Create `src/state/theme.ts`: a typed theme module exposing `ONYX_DARK_BASE`, `ONYX_FOLIO_BASE`, `applyTheme(theme, accentHex)`, `setAccentColor(hex)`, `hexToRgba`, `lightenHex`, and a `prefers-color-scheme` listener for System mode. `applyTheme` writes to `document.documentElement.style` (sets CSS custom properties) — does **not** mutate any JS object. Components reference theme values via `var(--onyx-…)` in inline styles. Export a TypeScript `Theme` type for IDE autocompletion only.

#### State and helpers

- **Step 9.** Port the rest of `state.jsx` to `src/state/onyx.ts`: the `useOnyxState` hook (typed); helpers (`parseDur`, `fmtTime`, `fmtRemaining`, `chapterAt`, `chapterStart`); mock data (`LIBRARY`, `CHAPTERS`, `BOOKMARKS`, `AUDIO_DEVICES`, `SPEEDS`); typed interfaces (`LibraryItem`, `Chapter`, `Bookmark`, `AudioDevice`, `OnyxState`). Preserve the localStorage persistence pattern verbatim — Tauri's WebView supports localStorage natively.

#### Primitive components

- **Step 10.** Port `icons.jsx` → `src/components/Icon.tsx` + `src/components/Waveform.tsx`. Define a typed `IconName` union covering every icon used: `play`, `pause`, `skip-back`, `skip-forward`, `volume`, `mute`, `heart`, `bookmark`, `plus`, `search`, `chevron-left`, `chevron-right`, `chevron-down`, `check`, `dot`, `headphones`, `speaker`, `airplay`, `bluetooth`, `monitor`.
- **Step 11.** Port `books.jsx` → `src/components/Cover.tsx` (square 1:1 placeholder). `LIBRARY` moves to `state/onyx.ts` from Step 9; `Cover.tsx` keeps only the placeholder rendering logic.
- **Step 12.** Port `chrome.jsx` → `src/components/chrome/`: one file each for `OnyxWash`, `Titlebar` (Windows-style rectangular controls), `Glass` (translucent-surfaces-toggle aware), `TopNav` (Home + Library + search + avatar only), `VolumeControl`, `DeviceSelector`.

#### Shelf scaffolding

- **Step 13.** Port the shelf-internal components from `browse.jsx` to `src/components/shelf/`: `BrowseView` (with its `inline` mode), `BrowseList`, `ViewModeToggle`, `Section`, `SortIndicator`, `CoverFan`, `CoverMosaic`, `CoverFill`, `StackedCovers`, `Initial`, `TileMini`.
- **Step 14.** Port the shelf tab views from `browse.jsx` → `src/components/shelf/tabs/`: `SeriesView`, `AuthorsView`, `NarratorsView`, `CollectionsView`. Each renders via `inline` mode inside the Library shelf.

#### Library screen (largest portion of Phase 2)

- **Step 15.** Port the Library screen shell to `src/screens/Library.tsx`: the two-column layout (Focus panel + right column) without yet wiring the shelf body.
- **Step 16.** Port the **Focus card** to `src/components/FocusPanel.tsx`: cover, series link, title, by-line, Continue button, progress bar, Bookmarks/Synopsis drawer, Duration/Chapters/Speed stats footer, collapse-to-strip behavior. Include the `ChaptersStat` and `SpeedStat` popovers (which were the next pending item in the prior Avalonia roadmap).
- **Step 17.** Port the **Pick it up** collapsible row → `src/components/PickItUp.tsx`. Include the persisted collapsed state and rotated-chevron animation.
- **Step 18.** Port the **Shelf header** (title + count + context filter pill + `ShelfTabs` + filter pills + grid/list toggle) and the **Shelf body** routing between the five shelf tabs (`library`, `series`, `authors`, `narrators`, `collections`) based on the `shelfTab` state.
- **Step 19.** Port the **Library shelf (Home tab)** rendering: grid view (`repeat(auto-fill, minmax(...))` with S/M/L/XL cover-size mapping at 80/96/116/148px, current-book border, progress overlay toggle); list view (`ShelfList`: cover thumb, title + series, author, genre, narrator, duration, click-to-sort).

#### Player and Home

- **Step 20.** Port `player.jsx` → `src/screens/Player.tsx`: now-playing card, waveform (chapter-scoped scrubbing), transport, speed pills, sleep timer popover (Off/5m/15m/30m/1h/End of chapter with live countdown), bookmark-this-moment button.
- **Step 21.** Port the optional Home dashboard from `browse.jsx` → `src/screens/Home.tsx`. Conditionally rendered only when `showHome` is true.

#### Settings and finishing

- **Step 22.** Port `settings.jsx` → `src/screens/Settings.tsx` + `src/components/settings/`: `AccountSection`, `ServerSection`, `PlaybackSection`, `AudioSection`, `LibrarySection`, `DownloadsSection`, `AppearanceSection` (theme/accent/translucent/scale), `KeyboardSection`, `AboutSection`. Every setting persists via localStorage through the hooks from Step 9.
- **Step 23.** Implement the `transform: scale()` interface-scale system on `#root` with inverse-sized viewport units (`100/z vw × 100/z vh`). Verify at all four scales (90/100/110/125%).
- **Step 24.** Replace `App.tsx` with the screen-switch root composition. Tag `v0.1.0-ui-shell`.

---

### Phase 3 — Window chrome wiring

- **Step 25.** Configure the Tauri window: `decorations: false`, `transparent: true` if supported, dark background.
- **Step 26.** Wire the Windows-style minimize / maximize / close buttons in `Titlebar.tsx` to Tauri's `appWindow` API.
- **Step 27.** Apply `data-tauri-drag-region` to the titlebar background. Mark the buttons themselves as `data-tauri-drag-region="false"` so clicks register as button presses, not drag starts.

---

### Phase 4 — Rust backend

End-of-phase deliverable: a complete Rust backend exposing every Tauri command the frontend will need, validated against a real Audiobookshelf server via standalone test calls.

- **Step 28.** Add backend crate dependencies to `src-tauri/Cargo.toml`: `reqwest` (HTTP), `serde` + `serde_json` (models), `tokio` (async runtime), `keyring` (token storage), `directories` (config paths), `chrono` (timestamps), `vlc-rs` (audio engine). Each step that adds dependencies will explain the relevant Cargo flags (e.g., `--features`, dev-vs-runtime distinction).
- **Step 29.** Create `src-tauri/src/models.rs` mirroring the C# models from the previous project: `Server`, `User`, `Library`, `LibraryItem`, `BookMedia`, `BookMetadata`, `Chapter`, `MediaProgress`, `MeResponse`, `ListeningStats`, `Bookmark`, `AudioTrack`. Use `#[derive(Deserialize, Serialize)]` with `#[serde(rename_all = "camelCase")]`. Use `#[serde(untagged)]` enums for the author minified-vs-expanded JSON shape issue encountered in the prior project.
- **Step 30.** Create `src-tauri/src/api.rs` — the Audiobookshelf HTTP client. Initial endpoints: `POST /login`, `GET /api/me`, `GET /api/libraries`, `GET /api/libraries/{id}/items`, `GET /api/items/{id}`. Cross-check every path against `https://api.audiobookshelf.org`. Apply the routing lesson learned previously: `BaseAddress` is the server root; `/login` lives at root, all other endpoints under `/api/`.
- **Step 31.** Create `src-tauri/src/auth.rs` — token persistence via `keyring` (Windows Credential Manager). Expose `save_token`, `load_token`, `clear_token`.
- **Step 32.** Expose Phase 4 work via Tauri commands in `src-tauri/src/commands.rs`: `login`, `logout`, `fetch_libraries`, `fetch_library_items`, `fetch_item`. Register them in `main.rs` via the `invoke_handler!` macro.
- **Step 33.** Add the remaining endpoints from the prior Avalonia roadmap: `GET /api/users/{id}/listening-stats`, `POST /api/me/item/{id}/bookmark`, `PATCH /api/me/progress/{id}`, plus session lifecycle (`POST /api/session/{id}/sync`, `POST /api/session/{id}/close`). Expose each as a Tauri command.
- **Step 34.** Add `src-tauri/src/audio.rs` — LibVLC via `vlc-rs`. Operations: `load(url)`, `play`, `pause`, `seek(secs)`, `set_speed(f)`, `set_volume(f)`, `position()`, `duration()`, `is_playing()`. Apply the prior project's token-in-URL convention (`?token={JWT}`) — `:http-header=` does not reliably forward custom headers in LibVLC. **Largest single-step risk; allow 5–14 days.**
- **Step 35.** Add the periodic 30-second session sync via `tokio::time::interval`, and the sync-then-close shutdown sequence triggered by Tauri's `RunEvent::ExitRequested`. This is the same pattern validated against Audiobookshelf GitHub issue #724 in the prior project. Emit position/playing/duration updates to the frontend via `tauri::Window::emit`.
- **Step 36.** Add `src-tauri/src/cover_cache.rs` — on-disk cache of cover images under the platform config directory (resolved via the `directories` crate).

---

### Phase 5 — Frontend ↔ backend wiring

End-of-phase deliverable: every UI control that previously manipulated mock state now drives the real Rust backend, validated against a live Audiobookshelf server.

- **Step 37.** Create `src/api/abs.ts` — a thin TypeScript wrapper around `@tauri-apps/api/core invoke()`, one function per backend command, fully typed against the Rust models. Use a code-generation approach if convenient, otherwise write by hand.
- **Step 38.** Replace the mock `LIBRARY` array in `state/onyx.ts` with a fetched library, loaded by an effect at app start. Show a loading state until the first response arrives.
- **Step 39.** Replace the mock `setInterval` playback tick with subscriptions to Rust backend events. Position, `playing`, duration come from the backend via `@tauri-apps/api/event listen()`; the frontend only displays.
- **Step 40.** Wire play/pause/seek/speed/volume controls to backend commands. Verify against a real Audiobookshelf server.
- **Step 41.** Wire the Home Stats cards and the focus card's "Bookmarks N" counter to listening-stats and `/api/me` data, matching the prior Avalonia roadmap's Step 34c.
- **Step 42.** Wire chapter selection, speed popover selection, and bookmark create/delete to backend commands.

---

### Phase 6 — Login flow

- **Step 43.** Build a pre-shell login screen shown when no valid token exists. Wire to the `login` Tauri command. On success, persist via keyring and proceed to the main shell.
- **Step 44.** Implement Settings → Account "Sign out": clear keyring token, drop in-memory state, return to the login screen.

(Settings persistence is already implemented within Phase 2 via localStorage, matching the prototype's pattern. Bookmarks and progress sync via the real Audiobookshelf endpoints in Phase 5.)

---

### Phase 7 — Packaging

- **Step 45.** Configure the Tauri bundler for Windows MSI and NSIS installers in `tauri.conf.json`. Set icons, version metadata. Code signing is deferred until a certificate is available.
- **Step 46.** Run `pnpm tauri build` and verify the produced installer launches the app on a clean Windows machine.
- **Step 47.** Tag `v0.1.0`. The first shippable alpha is complete.

---

### Risk register

|Risk|Phase|Mitigation|
|---|---|---|
|**`vlc-rs` API gaps.** The Rust binding to LibVLC covers what Skald needs but is less polished than LibVLCSharp. Step 34 may surface missing calls.|4|Drop to `libvlc-sys` raw FFI for any missing call. LibVLC's C ABI is stable; this is well-trodden territory.|
|**JSON shape variance.** The Audiobookshelf API returns the same logical field in different shapes depending on minified vs. expanded responses (notably `author` as string vs. object).|4 (Step 29)|`#[serde(untagged)]` enums plus, where necessary, custom deserializers. Already encountered and solved in the prior project.|
|**CSS custom property re-paint behavior under React 18 strict mode.** When `applyTheme` writes to `:root`, every component re-renders for unrelated reasons.|2 (Steps 7–8)|CSS custom properties propagate via the CSS engine, not React. Re-render is not required for the visual update. Verify with a strict-mode test.|
|**Interface scale edge cases.** `transform: scale()` with inverse viewport units can produce sub-pixel rounding artifacts at certain DPIs.|2 (Step 23)|Test at common DPI settings (100/125/150/175/200%). If artifacts appear, fall back to a CSS `font-size` root-rem approach.|
|**WebView2 cold-start time.** Tauri's first launch can be slower than a native Avalonia app.|7|Acceptable per the prior architecture analysis; "open once, listen for hours" usage pattern absorbs the cold-start cost.|

---

### Deferred items (not in scope for `v0.1.0`)

- Linux and macOS builds
- Auto-update mechanism
- Code signing
- Offline downloads (Settings → Downloads section renders but lacks backing behavior)
- OS audio device enumeration (dropdown shows mock list; real device picking deferred)
- Cover image fetching from Audnexus / server metadata (placeholder system remains the loading/missing-art state)
- Themes beyond Onyx / Folio
- Plugin / extension system
- Library imports from non-Audiobookshelf sources

---

### Milestone tags

|Tag|After step|State|
|---|---|---|
|`v0.0.0-scaffold`|5|Empty Tauri app launches|
|`v0.1.0-ui-shell`|24|Full prototype navigable inside Tauri, mock data|
|`v0.1.0`|47|First shippable alpha against a real Audiobookshelf server|

---

### Verification approach

Each step ends with a manual verification check, matching the prior Avalonia project's approach:

- UI steps: `pnpm tauri dev` launches and renders the new content correctly.
- Backend steps: a temporary `invoke()` call from the browser dev console confirms the new command works against a real server.
- Settings steps: change the setting, restart the app, confirm persistence.

No formal unit-test framework is required for Phase 1–7. Test coverage can be added in a Phase 8 if desired.