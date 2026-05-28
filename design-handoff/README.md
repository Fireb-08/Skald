# Handoff: Skald — Onyx Direction

## Overview

**Skald** is a desktop audiobook player for self-hosted libraries (think of it as a player UI that points at the user's own Audiobookshelf-style server). The "Onyx" direction is the dark, editorial, jewel-box treatment — warm-leaning blacks, brass-gold accent, glassy panels, serif display type for book metadata, and monospace for technical labels. A light "Folio" theme is also defined and fully wired in the prototype.

This is **not a macOS app**. The titlebar uses Windows-style rectangular window controls. The keyboard shortcut hint reads `Ctrl+K` (the handler still accepts both Ctrl and ⌘ for cross-platform devs).

The app has these surfaces:

1. **Library** — the home screen of the app. Persistent layout:
   - **Focus card** (left) — the current/last-opened book in a tall card with cover, series link, title, author, narrator, big Continue button, progress bar, and an inline Bookmarks/Synopsis drawer + Duration/Chapters/Speed stats footer. Collapsible to a 76px vertical strip.
   - **Top region** — TopNav (Home + Library + search + avatar) and a collapsible "Pick it up" row of in-progress books.
   - **Shelf pane** — has its own tab bar (`Home · Series · Authors · Narrators · Collections`) embedded inside the shelf header. Switching tabs only updates the catalog content below — the focus card, top nav, and Pick it up row stay put.
2. **Player** — full-screen now-playing surface (cover stage + chapter waveform + transport + chapter list + bookmarks). Sleep timer + bookmark this moment are functional.
3. **Home (dashboard)** — optional welcome view with hero "continue listening", in-progress, recent additions, and listening stats. Toggle-able via Settings → Library.
4. **Settings** — multi-section preferences pane (Account, Server, Playback, Audio, Library, Downloads, Appearance, Keyboard, About) with a left rail.

The TopNav contains only Home (optional) + Library + search + avatar. Series/Authors/Narrators/Collections are sub-tabs **inside** the Library shelf, not top-level destinations.

## About the design files

The files in this bundle are **design references created in HTML/JSX (via Babel-in-browser)**. They are working prototypes intended to show the **intended look, layout, copy, and interactive behaviour** — not production code to copy directly.

The task is to **recreate this UI in the target codebase's environment** (React, Tauri + a frontend framework, Electron + React, native, etc.) using its established patterns and component libraries. The prototype is already written with React function components and inline-style objects, so the structure translates cleanly. State management is pulled into a single `useOnyxState()` hook; you'll want to break this apart for a real codebase (see *State management* below).

The mock data (`LIBRARY`, `CHAPTERS`, `BOOKMARKS`, `AUDIO_DEVICES`, `SPEEDS`) is illustrative only — replace with real data from your audiobook server / library backend.

## Fidelity

**High-fidelity (hifi).** Every screen has final colors, typography, spacing, copy, hover states, and interactions. Pixel-target the design as closely as the codebase's component primitives allow. Exact hex values, font sizes, and spacing are provided below and in the source files.

The audiobook **cover art is a placeholder system** — six typographic templates (`split`, `rule`, `numeral`, `pattern`, etc.) rendered in pure CSS so the design rhythm reads correctly without faking real cover art. Covers are **square (1:1 aspect)** to match the audiobook industry convention. In production, replace `Cover` with an image-from-server component; the placeholder can stay as the loading/missing-art state.

The design targets ~**1920×1080** desktop windows. Layout is currently tuned for that; at narrower widths the shelf header can crowd — flag if responsive collapse is needed.

## Design tokens

Defined in `app/state.jsx` as the `ONYX` object plus `ONYX_DARK_BASE` and `ONYX_FOLIO_BASE` palettes. Tokens are LIVE-MUTATED by the theme switcher and accent picker — `applyTheme(theme, accent)` rewrites `ONYX` in place so every inline-styled component repaints on next render.

### Theme palettes

There are two themes plus a "System" mode that follows `prefers-color-scheme`.

#### Onyx (dark)

| Token | Value | Use |
|---|---|---|
| `bg` | `#0b0b0e` | App background |
| `bgDeep` | `#08080b` | Deepest background wells |
| `panel` | `#131319` | Solid panel surface (when translucent surfaces is off) |
| `panel2` | `#1a1a22` | Popover / menu surface |
| `line` | `rgba(255,255,255,0.06)` | Hairline dividers |
| `text` | `#ebe7df` | Primary text (warm off-white) |
| `textDim` | `rgba(235,231,223,0.62)` | Secondary text |
| `textMute` | `rgba(235,231,223,0.38)` | Tertiary / labels |
| `glass` | `rgba(255,255,255,0.04)` | Glass panel fill |
| `glassStrong` | `rgba(255,255,255,0.07)` | Stronger glass (buttons over wash) |
| `glassEdge` | `rgba(255,255,255,0.09)` | Glass panel hairline border |

#### Folio (light)

| Token | Value | Use |
|---|---|---|
| `bg` | `#f4efe6` | Off-white warm paper |
| `bgDeep` | `#ebe5d8` | Deeper wells |
| `panel` | `#fbf8f2` | Solid panel surface |
| `panel2` | `#f1ebde` | Popover / menu surface |
| `line` | `rgba(38,30,18,0.10)` | Hairline dividers |
| `text` | `#26211a` | Primary text (warm ink) |
| `textDim` | `rgba(38,33,26,0.65)` | Secondary text |
| `textMute` | `rgba(38,33,26,0.42)` | Tertiary / labels |
| `glass` | `rgba(255,253,247,0.55)` | Glass panel fill |
| `glassStrong` | `rgba(255,253,247,0.75)` | Stronger glass |
| `glassEdge` | `rgba(38,30,18,0.10)` | Glass border |

### Accent color

Default brass-gold. Picker exposes 5 swatches and the user's selection persists. Accent shades are re-derived from the chosen hex by `applyTheme`:

| Derived | Computation |
|---|---|
| `accent` | Picked hex (e.g. `#d4a64a`) |
| `accentBright` | `lightenHex(accent, 0.08)` |
| `accentDim` | `rgba(accent, 0.18)` (dark) or `rgba(accent, 0.16)` (light) |
| `accentEdge` | `rgba(accent, 0.35)` (dark) or `rgba(accent, 0.45)` (light) |

Static CSS rules (focus ring, ::selection, scrollbar hover, hover states) reference the accent via CSS custom properties `--onyx-accent`, `--onyx-accent-r/g/b`, mirrored by `setAccentColor` on `:root`.

Status green `#5ac88a` is used only for the "audio device connected" dot.

### Typography

Three families. Imported via Google Fonts in `Skald App.html`:

```
Source Serif Pro (400, 500, 600, 700; italic 400)
Inter           (400, 500, 600, 700)
JetBrains Mono  (400, 500)
```

| Token | Stack | Use |
|---|---|---|
| `sans` | `"Inter", "Söhne", -apple-system, system-ui, sans-serif` | Body, UI, controls |
| `serif` | `"Source Serif Pro", Georgia, serif` | Display: book titles, screen titles, section headers, synopsis body |
| `mono` | `"JetBrains Mono", ui-monospace, Menlo, monospace` | Labels, timestamps, counters, all caps eyebrows |

**Type pattern:** an "eyebrow" in mono (10px, `letter-spacing: 0.12em`, `text-transform: uppercase`, color `textMute`) sits above a serif title. Body text is Inter 13–14px. Timestamps and counters are always mono. Apply `letter-spacing: -0.01em` to `-0.02em` on serif display at sizes >24px.

### Spacing & sizing

- **Outer screen padding:** 12px top, 24–32px sides, 24px bottom.
- **Panel padding:** 20–28px.
- **Gap between major regions:** 18–32px.
- **Tile / card internal padding:** 14px.
- **Button padding:** 6–8px vertical × 10–14px horizontal (small/pill); 11px × 18–22px (primary action).

### Radius

| Size | Use |
|---|---|
| 4px | Book covers |
| 6px | Small buttons inside popovers |
| 8px | Inputs, segmented controls |
| 10px | Primary buttons, panel popovers, transport buttons |
| 12px | Generic cards |
| 14–16px | Glass panels |
| 999px | Pill filters |

### Shadows

- Glass panels: `0 24px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)`
- Popovers: `0 16px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(212,166,74,0.08)`
- Big play button: `0 12px 32px rgba(212,166,74,0.4)` (uses accent alpha)
- Cover art: `0 1px 2px rgba(0,0,0,.3), 0 4px 16px rgba(0,0,0,.25)`

### Background "wash"

The whole app sits on an `OnyxWash` component (`app/chrome.jsx`) that layers three large radial-gradient glows + dotted noise. There are two variants: a warm-jewel dark wash and a softer warm-paper light wash; the component branches on `ONYX.isDark`. Reimplement as a fixed background layer behind route content; do not put it inside scrolling regions.

---

## Screens / Views

For exact markup, see the source files in `source/`. The summary below is enough to scaffold and check yourself against.

### 1. Window chrome (`Titlebar` in `app/chrome.jsx`)

- 44px tall, absolutely positioned across the top of the window. Marked `WebkitAppRegion: drag` so the whole bar is draggable when packaged as a desktop app.
- Left: an 18px brass-on-glass "S" logo + a mono eyebrow `Skald · {Theme}[ · {current-screen-subtitle}]`. Theme suffix tracks the active theme (`Onyx` when dark, `Folio` when light).
- Right: three Windows-style rectangular window buttons (minimize `–` / maximize `▢` / close `✕`) — 46×44, transparent background, no rounding, no gap between. Hover lifts background to 10% white. Mark `WebkitAppRegion: no-drag` on the button container.

### 2. Top navigation (`TopNav` in `app/chrome.jsx`)

- A `Glass` card (16px radius, blurred glass surface) sitting just under the titlebar inside every screen except Player and Settings.
- Items, left to right: **Home** (optional) · **Library**. The catalog browse tabs (Series, Authors, Narrators, Collections) live inside the Library shelf, **not** here.
- Active item is `text` color + bold + a 2px brass underline 14px below baseline. Inactive items are `textDim`.
- A flex search input fills remaining width — placeholder `Search {N} titles…`, leading search icon, trailing `Ctrl+K` keyboard hint pill. Typing in search filters in-place on whatever pane is active (Library shelf, Series tab, etc.) — does **not** route between panes.
- Trailing: a 28px circular brass avatar with the user initial (`J`). Click opens Settings.

### 3. Library screen (`app/library.jsx`)

Two columns: a 360px "In focus" `Glass` panel on the left, the right column filling the rest.

**Focus panel** (left, collapsible to a 76px strip):
- Eyebrow: `IN FOCUS`.
- Square book cover (clickable → opens Player).
- Series name as a brass mono link (`MASTERS & MAGES · 1`). Click toggles a context filter on the shelf.
- Serif book title (30px / weight 500 / line-height 1.05).
- `by {author} · {narrator}` row. Author and narrator are dashed-underline buttons; clicking toggles a context filter that scopes the shelf to that author or narrator.
- Primary action bar: `Continue · {Nh Nm}` (brass-fill, 44px tall) + a **bookmark** icon button (tooltip: "Bookmark this book").
- Progress bar (3px, accent on 8%-white track) with `{N}% · Ch. N / 18` on the left and a toggleable `Bookmarked 3×` on the right.
- Below: either the **Synopsis** (serif, 13.5px, line-height 1.55, color `textDim`, with a mono `SYNOPSIS` eyebrow) **or** the **Bookmarks drawer** (timestamp + label + chapter/date, click to jump to that point in the player). Toggled by the bookmark counter.
- Footer row: three clickable stats — `Duration` (static), `Chapters {N}` (opens chapter popover), `Speed {1.25×}` (opens speed popover). All three are baseline-aligned via matching padding.
- A vertical "grip" handle on the right edge collapses the panel.

**Collapsed strip** (76px):
- Mini cover at top → mini play button → vertical progress bar → rotated title text.

**Right column:**
- `TopNav`.
- **Pick it up** row — `Glass` cards for in-progress books, only shown when there are some and the user isn't actively filtering/searching. **Collapsible**: clicking the "Pick it up" header collapses to just the header with a rotated chevron; state persists.
- **Shelf pane** — see next section. Always visible. Switching shelf tabs only updates the catalog content below the shelf header.

### 4. Shelf pane (inside Library)

A single pane that has its own internal tab bar, hosting five views.

**Shelf header row** (single row across all tabs):
- LEFT — title + count + (Library tab only) context filter pill
- CENTER — `ShelfTabs` bar (`Home · Series · Authors · Narrators · Collections`)
- RIGHT — filter pills (Library tab only) + grid/list view toggle

The view-mode toggle is a single piece of state (`libraryView`) — selecting List on the Series tab carries the choice over to Home, Authors, Narrators, and vice versa. Persisted.

**Home tab** (the user's shelf — sets `shelfTab='library'`):
- Title: `The shelf` or `{contextFilter.value}`. Count subtitle: `{N} titles · sort: {sort name}`.
- Filter pills: `All / Reading / Unread / Finished`.
- Context filter pill (when filtering by series/author/narrator/collection): brass-tint removable pill with `{KIND} {value} ×`.
- Content (grid view): cover wall in `repeat(auto-fill, minmax({coverW}px, 1fr))` grid. Cover size S/M/L/XL controlled by Settings → Library. Each tile: square cover with optional brass border (current book) and footer progress bar (toggleable), then 11.5px title + 10.5px author below. Hover lifts the cover.
- Content (list view): wide-row table — cover thumb · title + series · author · genre (pill) · narrator (with headphones icon) · duration. Column headers click-to-sort, asc → desc on second click. Current book highlighted with brass tint + accent left-border.

**Series tab**:
- Subtitle: `{N} SERIES IN YOUR LIBRARY`.
- Grid: 280×~380px poster cards with `CoverFan` (lead 200px cover + up to 4 dimmed back covers fanned ±7° behind, plus a brass radial glow), serif series name, italic author, mono `N VOLUMES · {N}H` divider line.
- List: sortable table — Series · Author · Volumes · Duration, with a 28px lead cover thumbnail per row.
- Click a series → set `series` context filter, switch back to `library` shelf tab.

**Authors tab**:
- Grid: same 280×~380 poster pattern as Series, but cover-display is a `CoverMosaic` (up to 4 covers in 2×2 quilt). Serif author name + italic genre line (e.g., `Epic Fantasy · LitRPG`) + mono footer `N TITLES · {N}H`.
- List: Author · Titles · Duration, with brass-gradient `Initial` avatar per row.
- Click → `author` context filter + return to Home shelf tab.

**Narrators tab**:
- Grid: same poster pattern. Name shown with a leading headphones icon. Italic genre subtitle. Mono footer.
- List: Narrator · Titles · Duration, with `Initial` (headphones icon variant) per row.
- Click → `narrator` context filter + return to Home shelf tab.

**Collections tab**:
- Grid: same 280×~380 poster pattern. Empty collections show an "Empty collection" placeholder where the mosaic would go. A dashed `+ New collection` tile at the end of the grid prompts for a name + subtitle and adds a user-created collection.
- List: Collection · Description · Titles columns. A "New collection…" italic row at the bottom triggers the same create flow.
- Click a collection → set `collection` context filter (`{kind:'collection', value, bookIds}`) + return to Home shelf tab; the shelf filter shows only that collection's `bookIds`.

**Card uniformity**: Series/Authors/Narrators/Collections grid posters all share the same ~380px height (280px cover-display + ~100px padded text footer with serif name, italic subtitle, mono divider footer line).

**Popovers** (Chapters and Speed stats on the focus card):
- `panel2` background, 10px radius, 1px brass-glow outer ring.
- Chapters popover: mono header, scrolling list (each row = mono number, title, mono duration, state-indicator dot/check). Current chapter is brass-fill + brass text + glowing dot. Done chapters are muted. Scrolls current chapter to center on open.
- Speed popover: mono header + the five preset rows (0.8 / 1.0 / 1.25 / 1.5 / 2.0). Current row is brass-fill + brass mono.

### 5. Player screen (`app/player.jsx`)

Crumb on top: `← Library · {series}` on the left; on the right a `VolumeControl` and `DeviceSelector` (both from `chrome.jsx`).

Two columns:
- **Left cover stage** (480px wide): a brass radial glow behind a 420px square cover, then centered serif title block: mono series eyebrow (brass) → 48px serif title → `by {author}` (16px dim) → `narrated by {narrator}` (13px muted).
- **Right column** (flex): a now-playing `Glass` card on top, then chapters + bookmarks `Glass` cards side-by-side filling the remaining height.

**Now-playing card:**
- Header row: `NOW PLAYING · CH. N` mono eyebrow + serif chapter title on the left; `{m:ss} / {m:ss}` mono on the right.
- A 680×72 **waveform** (see `app/icons.jsx`) with deterministic-random bars. Click to scrub within the current chapter.
- Bottom row: 5 speed pills on the left; centered transport (skip-back, big 64px brass round play/pause with brass glow, skip-forward); two small icon buttons on the right (bookmark this moment, sleep timer).
- **Skip back/forward icons** are double-chevron + "30" labels — `‹‹ 30` and `30 ››`. Direction is unambiguous.
- **Bookmark this moment** button adds a new bookmark at the current position; appears at the top of the Bookmarks panel with "Just now" date.
- **Sleep timer** button opens a popover with `Off / 5m / 15m / 30m / 1h / End of chapter`. When active, the button expands to show a live countdown in brass mono (or `End of chapter` text). Auto-pauses playback when the timer elapses or the active chapter changes.

**Chapters card:** serif "Chapters" header + mono `{N} · {duration} total` subhead. Scrolling list. Each row: `01` mono index, chapter title, duration, state icon. Current chapter is brass-tinted with a glowing brass dot.

**Bookmarks card:** serif "Bookmarks" header + mono count + brass `+ ADD HERE` button (same effect as the transport bookmark button). Each row: brass mono timestamp + `Ch. N · date` eyebrow on a top line; bookmark label as 13px body below. Rows are click-to-jump.

### 6. Home (dashboard) view (`app/browse.jsx`)

Optional landing screen, toggle-able via Settings → Library → "Show Home tab".

- Big hero `Glass` (170px cover + glow on the left; on the right a `CONTINUE LISTENING` eyebrow, series, 38px serif title, by/narrated row, a progress bar with mono `{%} · Ch. N of M · {time} remaining`, and `Resume` (brass) + `Open player` (ghost) buttons).
- "Other books in progress" → auto-fill grid of `TileMini` cards (56px cover + title/author/progress).
- "Recently added" → row of 120px cover tiles.
- "Stats" → 4-up of glass tiles, mono label + 26px serif accent-colored number.

### 7. Settings screen (`app/settings.jsx`)

Crumb on top: `← Library · Settings`.

Two columns:
- **Left rail** (260px `Glass`): profile header at the top (38px brass avatar + name + dim mono email), then a nav list. Active item is brass-fill + brass text + brass border.
- **Right pane**: the section content. Sections: Account, Server, Playback, Audio, Library, Downloads, Appearance, Keyboard, About.

Pattern within sections: serif section title + mono caption, then setting rows — each row is `{label + dim caption}` on the left and the control on the right. Controls include text inputs (dark fill with brass focus), select pickers, toggle switches (brass when on), segmented controls (Pills), and "destructive" link-style buttons.

**Functional settings** (all persist to localStorage):
- **Appearance → Theme:** `Onyx (dark)` / `Folio (light)` / `System`. System tracks `prefers-color-scheme`.
- **Appearance → Accent color:** 5 swatches (brass `#d4a64a`, terracotta `#c96442`, sage `#7aa86a`, slate-blue `#5a8fc4`, mauve `#a86a8e`). Active swatch gets a white ring and a brass outer glow.
- **Appearance → Translucent surfaces:** toggle. When off, `Glass` falls back to a solid `panel` background with no backdrop blur (perf fallback for older hardware).
- **Appearance → Interface scale:** `90% / 100% / 110% / 125%`. Applied via `transform: scale()` on `#root` with inverse-sized root (`100/z vw × 100/z vh`) so layout reflows into the scaled canvas — no overflow or clipping.
- **Playback → Default speed / Skip duration / Auto-rewind / Auto-play next / Smart pause / Sleep timer default:** pills + toggles, all persisted.
- **Library → Default sort:** `Recently added / Title / Author / Most listened` — controls the shelf order.
- **Library → Cover size:** `S/M/L/XL` — maps to 80 / 96 / 116 / 148px shelf cover width.
- **Library → Group by series:** collapses series volumes to one tile.
- **Library → Show finished titles:** hides 100% books from the main grid.
- **Library → Show progress overlay:** toggles the gold progress bar on cover tiles.
- **Library → Show Home tab:** toggles the optional dashboard view (top-nav Home link).

Account section contains: name, email, listening-stats toggle. (A "Sync progress across devices" toggle was removed per design feedback.)

---

## Interactions & behavior

### Global

- **Keyboard:**
  - `Space` → play / pause (when not focused in an input).
  - `←` / `→` → skip ±30s (wired to `Skip duration` setting in production).
  - `Ctrl+K` / `⌘K` → focus the top-nav search input.
- **Playback tick:** while `playing`, the position advances by `1 × speed` seconds per real second. At end-of-book, playback stops automatically.
- **Search:** the search query is global state, applies in-place to whichever pane is active (shelf, Series tab, Authors tab, etc.), and **persists across panes** without losing input focus. Each pane matches against its own criteria (titles/authors/series for the shelf; series name + author for Series tab; etc.).
- **Context filter:** clicking a series / author / narrator / collection anywhere in the app sets a context filter on the shelf and routes to the Home shelf tab. The shelf shows a removable brass pill with `{KIND} {value} ×` until cleared.
- **Hover states:**
  - Cover tiles in the shelf lift by 3px and drop an accent-tinted shadow.
  - Poster cards (Series / Authors / Narrators / Collections) lift by 3px, brighten the border to `accentEdge`, and gain an accent outer-glow shadow.
  - Window buttons brighten their background to 10% white.
  - List rows get a faint accent row tint.
- **Selection:** focus rings are 2px accent at 2px offset. Selection color is `rgba(accent, 0.35)`.

### Focus card

- The series mono link, author button, and narrator button all toggle context filters. Clicking the same link twice clears the filter.
- The chapters and speed footer "stats" are clickable; they open popovers as described above.
- The "Bookmarked Nx" counter toggles the inline bookmarks drawer; when the drawer is closed, the synopsis is shown instead.
- The collapse handle on the right edge slides the panel between 360px and 76px. State persists.

### Player

- Click anywhere on the waveform → scrub to that fractional position **within the current chapter** (not the whole book). The waveform represents the current chapter only.
- Click any chapter row → seek to chapter start.
- Click any bookmark row → seek to `chapterStart(bm.ch - 1) + bm.secs`.
- Big play/pause button has an accent drop-shadow ring; the play icon is offset by 3px right for optical centering.

### Device selector

- A dropdown anchored under the device button. List of audio outputs with status dot (green = connected), icon, name, mono sub (`USB · 48 kHz · 24-bit` etc.). Selected item is brass-tinted.
- A footer toggle row for "Exclusive Mode."
- Click outside or pick an item to close.

### Volume control

- Mute icon button, then a 100px track with a 10px filled draggable thumb, then a mono numeric readout (0–100). The native `<input type=range>` is layered transparently over the visual track for accessibility / drag support.

### Animations & transitions

- Cover hover lift: `transform 0.15s, filter 0.15s`.
- Poster hover lift: `transform 0.15s, border-color 0.15s, box-shadow 0.15s`.
- Popover chevron rotation: `transform 0.15s`.
- "Pick it up" collapse chevron: `transform 0.18s`.
- Progress fill on the focus card: `transition: width 0.2s` so playback ticks animate smoothly.
- Bookmark drawer entrance: `animation: onyx-fadein 0.18s ease-out`.

---

## State management

Lives in `useOnyxState()` (`app/state.jsx`). One hook, useReducer-free, React.useState across many keys plus localStorage persistence for user preferences. If you're moving this to a real codebase, you'll likely want to split this into:

- An **audio playback store** (Zustand / Redux / Tauri command bridge) for `position`, `playing`, `volume`, `muted`, `speed`, `device`. The current `setInterval` tick is a stand-in for real audio element / native audio bridge.
- A **navigation router** (React Router / TanStack Router / your framework's equivalent) for `screen`, `shelfTab`, and probably `contextFilter`. The mock uses local state with localStorage for `shelfTab`.
- **UI preferences store** for everything in Settings (theme, accent, library prefs). Keep using `localStorage` (or the OS preferences API in a desktop app).
- **UI state per-route** (focus collapse, bookmarks drawer open, popovers, browse mode) — fine to keep co-located in each route component.

### State variables (current mock):

| Variable | Type | Persist | Notes |
|---|---|---|---|
| `screen` | `'library' | 'player' | 'settings' | 'home'` | no | Top-level route. Series/Authors/etc are NOT top-level. |
| `currentBookId` | string | no | Which book is "in focus" / playing |
| `playing`, `position`, `volume`, `muted`, `speed`, `device` | various | no | Playback state |
| `deviceOpen` | bool | no | Device popover |
| `focusCollapsed` | bool | no | Library focus panel collapsed |
| `filter` | `'all' | 'reading' | 'unread' | 'finished'` | no | Shelf status filter |
| `contextFilter` | `{kind, value, bookIds?} | null` | no | Shelf context filter — `kind` is `'series' | 'author' | 'narrator' | 'collection'` |
| `search` | string | no | Global search query |
| `libraryView` | `'grid' | 'list'` | yes | Unified view mode across all shelf tabs |
| `shelfTab` | `'library' | 'series' | 'authors' | 'narrators' | 'collections'` | yes | Which catalog view is active inside the shelf |
| `pickItUpCollapsed` | bool | yes | Pick it up row collapsed |
| `theme` | `'dark' | 'light' | 'system'` | yes | Active theme |
| `accentColor` | hex string | yes | Selected accent |
| `translucent` | bool | yes | Glass effect enabled |
| `librarySort`, `coverSize`, `groupBySeries`, `showFinished`, `showProgressOverlay`, `showHome` | various | yes | Library prefs |

### Data fetching

The mock embeds everything in JS. In the real app:

- **`LIBRARY`** comes from the audiobook server (the user's self-hosted library). Each item: `{ id, title, author, series, narrator, dur, progress, palette?, tpl?, genre, synopsis }`.
- **`CHAPTERS`** is per-book; the mock uses a single hardcoded array. Fetch chapter metadata from the file or sidecar.
- **`BOOKMARKS`** are user-owned and per-book; sync these to the server alongside `progress`.
- **`AUDIO_DEVICES`** comes from the OS audio enumeration (Tauri command / Electron `desktopCapturer` / native bridges / `navigator.mediaDevices.enumerateDevices()` for web).
- **`SPEEDS`** is static.
- **Collections** are user-curated and persisted to the server.

`fmtTime`, `fmtRemaining`, `parseDur`, `chapterAt`, `chapterStart` are helpers; copy them verbatim or reimplement.

---

## Components in the prototype

| Component | File | Role |
|---|---|---|
| `App` | `app/app.jsx` | Root — owns the wash, titlebar, and screen switch |
| `OnyxWash` | `app/chrome.jsx` | Fixed background layer (gradients + noise) — branches on `ONYX.isDark` |
| `Titlebar` | `app/chrome.jsx` | Draggable window chrome (Windows-style controls) |
| `Glass` | `app/chrome.jsx` | The glass panel primitive used everywhere — translucent surfaces toggle aware |
| `TopNav` | `app/chrome.jsx` | Persistent top nav (Home + Library + search + avatar) |
| `VolumeControl` | `app/chrome.jsx` | Mute + slider + readout |
| `DeviceSelector` | `app/chrome.jsx` | Audio device dropdown |
| `Library` | `app/library.jsx` | Library screen container |
| `ShelfTabs` | `app/library.jsx` | The in-pane tab bar inside the shelf header |
| `ShelfList` | `app/library.jsx` | Wide-row list view of the library shelf |
| `Stat`, `ChaptersStat`, `SpeedStat` | `app/library.jsx` | Footer stats inside the focus card |
| `Player` | `app/player.jsx` | Player screen |
| `HomeView`, `SeriesView`, `AuthorsView`, `NarratorsView`, `CollectionsView` | `app/browse.jsx` | Browse surfaces. The non-Home ones render inside the shelf pane (pass `inline` prop). |
| `BrowseView`, `BrowseList`, `ViewModeToggle`, `Section`, `SortIndicator` | `app/browse.jsx` | Shared browse scaffolding. `BrowseView` has an `inline` mode for use inside the Library shelf. |
| `CoverFan`, `CoverMosaic`, `CoverFill`, `StackedCovers`, `Initial`, `TileMini` | `app/browse.jsx` | Tile compositions used inside the browse cards |
| `Cover` | `books.jsx` | Pure-CSS square audiobook cover placeholder |
| `Waveform`, `Icon` | `app/icons.jsx` | Icon set + waveform renderer |
| `Settings` | `app/settings.jsx` | Settings screen + all section panes |
| `useOnyxState` | `app/state.jsx` | Single state hook for the whole prototype |
| `applyTheme`, `setAccentColor` | `app/state.jsx` | Live-mutate the shared `ONYX` palette + repaint |

---

## Assets

- **No external image assets** are used. Cover art is rendered with `Cover` (6 typographic templates in pure CSS, see `books.jsx`). All other glyphs are SVG icons in `app/icons.jsx`.
- **Fonts** are pulled from Google Fonts (Source Serif Pro, Inter, JetBrains Mono). For desktop / offline builds, vendor these into the app and remove the `<link rel=stylesheet>` from `Skald App.html`.
- **Audio device icons** are part of the in-house icon set: `headphones`, `speaker`, `airplay`, `bluetooth`, `monitor`. Add more here if you support additional device types.

In production you'll likely want:
- Real cover image fetching (Audnexus / your server's metadata endpoint) with the `Cover` placeholder as the loading / missing-art fallback.
- A real audio playback layer (Howler.js / native bridge / `<audio>` element / Tauri audio plugin / etc).
- A real OS audio device enumeration + selection API.

---

## Files in this bundle

Everything you need to render the prototype is in `source/`:

```
source/
  Skald App.html        — entry HTML; loads Google Fonts, React UMDs, Babel,
                          and all the JSX files in order. Defines CSS custom
                          properties (--onyx-accent etc.) consumed by static rules.
  books.jsx             — LIBRARY data + square Cover placeholder
  app/
    app.jsx             — App root + screen switch
    state.jsx           — useOnyxState hook + ONYX tokens + theme palettes +
                          applyTheme + mock data (CHAPTERS, BOOKMARKS, etc.)
    chrome.jsx          — OnyxWash, Titlebar, Glass, TopNav,
                          VolumeControl, DeviceSelector
    icons.jsx           — Icon set + Waveform component
    library.jsx         — Library screen + ShelfTabs + ShelfList +
                          focus card popovers
    player.jsx          — Player screen with sleep timer + bookmark
    browse.jsx          — Series / Authors / Narrators / Collections views
                          (rendered inline inside Library shelf) +
                          Home dashboard view
    settings.jsx        — Settings screen + sections + InterfaceScalePicker +
                          AppearanceSection (theme/accent/translucent/scale)
```

Open `source/Skald App.html` directly in a browser to see the live prototype. It runs entirely client-side via Babel-in-browser. You can click through every screen, scrub the waveform, toggle the focus panel, switch shelf tabs, change themes/accents, open the chapter/speed/device/sleep popovers, create collections, etc.
