# Handoff: Skald — First-Launch Greeting Pane

## Overview
A **greeting / dashboard pane** for the Skald desktop application (an audiobook client that connects
to a self-hosted **Audiobookshelf** server). It occupies the left **"In focus"** slot of the Library
screen and is shown **on first launch, before anything is playing** — in place of the now-playing focus
card.

The pane contains:
1. A live **date** line + time-aware **greeting** with the user's name.
2. A **Your stats ⇄ Library stats** segmented toggle.
3. The selected **stats page** (numbers, gold ranked bars, and a 7-day listening sparkline).
4. A persistent footer strip: **In library / In progress / Finished**.

It is a direct sibling/replacement for the existing focus card, sharing the exact same card footprint
(`width: 360`, `padding: 28`, glass surface) so it slots into the Library layout without disturbing it.

## About the Design Files
The files in this bundle are **design references created in HTML/React (inline Babel)** — a working
prototype showing the intended look and behavior. They are **not production code to copy verbatim.**
The task is to **recreate this pane in the real Skald codebase**, using its established components,
tokens, fonts, and data layer. The prototype uses inline style objects purely for self-containment;
use the host app's styling system.

The pane is already authored as a near-drop-in component: `source/greeting.jsx` exports
`GreetingPane({ st, name })` and depends only on globals the real app already defines (`ONYX`, `Glass`,
`LIBRARY`). In the real app it would render inside `Library` where the focus `Glass` card currently sits.

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, the sparkline, and the ranked bars should be
reproduced faithfully. Exact tokens are in the Design Tokens section.

## Screen / View

### The greeting pane (360px glass card, left column of the Library screen)
Vertical flex, `padding: 28`, `overflow: hidden`, with a faint gold hairline across the top edge
(`linear-gradient(90deg, transparent, accentEdge, transparent)`, 1px tall, inset 22px L/R).

Top → bottom:

#### 1. Date eyebrow
- Live, formatted `WEEKDAY, MONTH D` (e.g. `TUESDAY, JUNE 2`), **uppercased**.
- JetBrains Mono, 10px, color `textMute`, letter-spacing `0.18em`.

#### 2. Greeting
- Source Serif Pro, **30px / 500**, line-height 1.08, letter-spacing `-0.015em`, color `text`.
- Two lines: `{greeting},` then `{name}` with a **gold period** (`.` in accent color).
- `greeting` is time-aware from `new Date().getHours()`:
  `<5 night` → "Still up", `<12` → "Good morning", `<17` → "Good afternoon",
  `<21` → "Good evening", else "Still up".

#### 3. Toggle (segmented control)
- Container: `display:flex; padding:3; gap:3; background:glass; border:1px glassEdge; border-radius:10`.
- Two equal buttons: **Your stats**, **Library stats**.
- Active button: background `accentDim`, inset ring `0 0 0 1px accentEdge`, text `accent`, weight 600.
- Inactive: transparent, text `textDim`, weight 500. 12px font. Switches the body below.
- Default selected: **Your stats**.

#### 4a. Stats body — YOUR STATS
- **Hero trio** (flex, gap 24), each a `BigStat` (serif 26/500 number + mono 9px uppercase label):
  - `Minutes` = total minutes listening (sample **5,210**, shown with thousands separator)
  - `Days listened` (sample **30**)
  - `Finished` items (sample **3**)
- **"Minutes listening · last 7 days"** subhead (mono 9.5px, `0.16em`, uppercase, `textMute`), then a
  **sparkbar chart** (`SparkBars`):
  - 7 bars, oldest→newest, labeled Wed…Tue. Sample minutes: `[0, 60, 0, 0, 184, 0, 10]`.
  - Bar height = `max(4, round(m / max * 88))`px; zero days render a 2px `rgba(255,255,255,0.08)` stub.
  - Non-zero bars: `linear-gradient(180deg, accentBright, accent)`. The **max** bar gets a
    `0 0 12px accentEdge` glow and its value label is in `accent`.
  - Value sits above each bar (mono 8.5px), day label below (mono 8.5px, `textMute`). Chart height 96px.
- **4-up MiniStat row** below the chart (serif 18px number + tiny mono unit + mono uppercase label):
  - `This week` 255 min · `Daily avg` 36 min · `Best day` 184 min · `Streak` 1 day.
- **Recent sessions** subhead, then up to 3 rows: title (12.5px, ellipsized) + relative time
  (mono 9px uppercase, `textMute`) on the left; session length in `accent` mono 11px on the right.
  Rows divided by 1px `line` top borders. Sample: "Empire of the Vampire" — 9 min / 3h ago, etc.

#### 4b. Stats body — LIBRARY STATS
- **Hero quad** (flex, gap 12), `BigStat` each, widths tuned to fit one row (74/56/56/58):
  - `Hours` 3,285 · `Authors` 43 · `Tracks` 708 · `GB` 146.2.
- **Top genres** subhead, then ranked bars (`RankBar`, no rank number):
  - Each: label (12px, ellipsized) + percentage in `accent` mono on the right; below, a 5px track
    (`rgba(255,255,255,0.07)`, radius 3) filled to `pct%` with `linear-gradient(90deg, accentDeep, accent)`.
  - Sample: Science Fiction & Fantasy 73%, Literature & Fiction 20%, Fantasy 17%, Teen & Young Adult 4%.
- **Top authors** subhead, then ranked bars (`RankBar` **with** rank number 1…5, 14px mono gutter):
  - Right value = book count; bar `pct = value / maxValue * 100`. Track indented to align under label.
  - Sample: Brandon Sanderson 57, Andrzej Sapkowski 9, Miles Cameron 9, Andrew Rowe 8, Matt Dinniman 8.

The stats body is `flex: 1; min-height: 0; overflow: auto` so either page scrolls within the pane if the
window is short, without pushing the footer off.

#### 5. Footer stat strip (always present)
- `margin-top: 18; padding-top: 18; border-top: 1px line; display: flex; gap: 28`.
- Three `GreetStat`s (mono 9px uppercase label + serif 22/500 value):
  - `In library` = total library count
  - `In progress` = count with `0 < progress < 0.98`
  - `Finished` = count with `progress >= 0.98`
- These three are derived from the **local library list**, not the remote stats payload.

## Interactions & Behavior
- **Toggle:** clicking a segment swaps the stats body. Prototype keeps it in local `useState`
  (default `'user'`). Consider persisting the last choice per user in the real app.
- **Date & greeting** recompute from the real clock on render.
- All numbers in the stats pages are **sample values** mirroring the Audiobookshelf dashboard
  (see Data section). Wire them to the live server payload in production.
- No hover affordances are required on the stats themselves; the toggle and footer are the only
  controls. (The original focus-card hover/press states do not apply here.)

## Data
The stats correspond to fields Audiobookshelf exposes on its **Library Stats** and **Your Stats**
dashboards. Suggested mapping (confirm against the server's `/api` stats endpoints):

**Your stats**
- `minutesTotal` — total minutes listened (hero "Minutes")
- `daysListened` — distinct days with listening activity
- `finished` — items finished
- `last7[]` — `{ day, minutes }` for the last 7 days (sparkline)
- `weekMinutes`, `dailyAvg`, `bestDay`, `streak` — summary figures under the chart
- `recent[]` — `{ title, when (relative), length }` recent listening sessions

**Library stats**
- `hours` — overall hours across the library
- `authors` — distinct author count
- `tracks` — total audio tracks
- `sizeGb` — total size in GB
- `topGenres[]` — `{ label, pct }` (top genres by share)
- `topAuthors[]` — `{ label, value }` (top authors by item count)

(Audiobookshelf also provides "Longest items", "Largest items", and a year-in-review — omitted here to
fit the 360px pane, but candidates for a future expanded view.)

## State Management
- `page: 'user' | 'library'` — local toggle state (default `'user'`).
- Everything else is read from props/data: the `st` app-state object (only used for the footer counts
  via the global `LIBRARY` in the prototype) and the two stats payloads.
- In the real app, replace the hard-coded `USER_STATS` / `LIBRARY_STATS` constants in `greeting.jsx`
  with data fetched from the server, and derive the footer counts from the real library store.

## Design Tokens (Onyx theme)
Colors:
- `bg` `#0b0b0e` · `panel` `#131319` · `panel2` `#1a1a22`
- `text` `#ebe7df` · `textDim` `rgba(235,231,223,0.62)` · `textMute` `rgba(235,231,223,0.38)`
- `line` `rgba(255,255,255,0.06)` · `glass` `rgba(255,255,255,0.04)` · `glassEdge` `rgba(255,255,255,0.09)`
- `accent` `#d4a64a` · `accentBright` `#e9bb5e` · `accentDeep` `#a37d2e`
- `accentDim` `rgba(212,166,74,0.18)` · `accentEdge` `rgba(212,166,74,0.35)`
- (The app also ships a light "Folio" theme; tokens are theme-mutated at runtime. This pane uses only
  token references, so it inherits theme switches automatically.)

Typography:
- Serif (numbers, greeting): **Source Serif Pro** (400/500/600).
- Mono (labels, eyebrows, values): **JetBrains Mono** (400/500).
- Sans (UI/body): **Inter** (400/500/600/700).

Card / spacing:
- Card: `width 360`, `padding 28`, `border-radius 16` (the shared `Glass` surface), 1px `glassEdge`
  border, shadow `0 24px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)`.
- Section rhythm: 18px between header/toggle/body/footer; 22px between stat sections; 11px between bars.
- Sparkline chart height 96px; ranked-bar track 5px; footer stat gap 28px.

## Assets
No raster assets. All glyphs are from the shared `Icon` set / Unicode. Book covers in the surrounding
shelf (context only) are procedurally generated by the app's `Cover` component. Fonts load from Google
Fonts — swap to the app's bundled equivalents in production.

## Files
- `source/greeting.jsx` — **the pane itself.** Exports `GreetingPane({ st, name })` plus the small
  presentational helpers (`UserStats`, `LibraryStats`, `BigStat`, `MiniStat`, `SparkBars`, `RankBar`,
  `SubHead`, `GreetStat`) and the sample `USER_STATS` / `LIBRARY_STATS` constants to replace with live data.
- `source/reference/chrome.jsx` — the app's shared chrome (`Glass`, `OnyxWash`, `Titlebar`, `TopNav`) —
  shows the `Glass` surface this pane sits in.
- `source/reference/state.jsx` — defines the `ONYX` token object and theme palettes (search "const ONYX").
- `source/reference/library.jsx` — the Library screen; shows exactly where the focus card (and therefore
  this greeting pane) mounts in the left column.
- `Greeting Preview.html` — a standalone, interactive preview: the full app window with the greeting pane
  in the left slot and a representative shelf on the right. Toggle the two stats pages live.

To view: open `Greeting Preview.html` and click **Your stats / Library stats** to switch pages.
```
Library (left column)
└─ <Glass width=360>           ← focus card slot
   └─ GreetingPane             ← this component (first launch / nothing playing)
```
