## Context

Skald (at `C:\Users\fireb\Documents\Skald`) is a native Windows desktop client (Tauri + React + Rust) that connects to an Audiobookshelf server. The user wants to know which features the official Audiobookshelf WebUI client offers that Skald currently does not. This document is the deliverable: an organized list of gaps. No code changes are proposed — this is a review.

Scope note: Skald is a _client_ for ABS, not a replacement for the ABS server. Some WebUI features (server admin, scanner, backups, RSS feeds) are inherently server-side configuration surfaces and may be intentionally out-of-scope for a desktop listening client. Gaps are listed regardless; relevance is annotated where useful.

---

## 1. Library Types & Content Coverage

Features in WebUI, missing in Skald:

- **Podcast libraries** — full podcast subscription, RSS feed add, OPML import, episode list browsing, per-episode progress
- **Podcast auto-download** — cron-scheduled episode polling, max-episode retention, "download since date"
- **Find Episodes** workflow against an RSS feed
- **Ebook libraries (EPUB / PDF / CBR / CBZ / AZW3 / MOBI)** — no ebook awareness at all
- **In-browser ebook reader** — EPUB/PDF reader with reading-progress tracking and bookmarks
- **Primary vs. supplementary ebook designation** within an item
- **Mixed audiobook+ebook items** (the "Read" button alongside "Play")

## 2. Media Organization

- **Playlists** — Skald has Collections but no per-user playlists (playlists can mix audiobooks and podcast episodes in WebUI)
- **Subseries** — collapsible subseries grouping
- **Drag-to-reorder** of collection/playlist items
- **Genre browse view** (Skald has Series / Authors / Narrators / Collections, but no Genres tab)
- **Publisher browse / filter**
- **Tag-based filtering** with inclusive/exclusive toggle
- **Explicit-content flag** awareness/filtering

## 3. Metadata Editing & Matching

- **Edit item metadata** from the client (title/author/series/narrator/genres/ISBN/description) — Skald exposes Match/Re-Scan/Delete only, no full metadata editor
- **Batch metadata edit** across multiple items
- **Batch quick-match** across selection
- **Manage Tracks** UI (enable/disable, reorder audio files within an item)
- **Chapter editor** — create/edit/rename chapter markers
- **Audnexus chapter lookup** integration
- **Cover finder UI** — search Audible / Google / iTunes / OL / audiobookcovers and pick a cover
- **Upload custom cover** from local file
- **Metadata provider selection per-library** (Audible regional variants, Google Books, OL, iTunes)
- **Custom metadata providers (v2.8+)** — register community providers with auth tokens
- **Batch removal of metadata.json / metadata.abs files**

## 4. Search & Discovery

- **Customizable home-page shelves** — define shelves by any field (genre/tag/author/series)
- **"Newest Series" / "Recent Authors" / discovery shelves** beyond Continue Listening
- **Advanced search field selection** (title vs author vs series scoping)
- **Filter by tag, publisher, language, explicit flag**
- **Natural sorting** of titles (planned in WebUI, not in Skald)
- **Quick author / series jump** from search results

## 5. Playback

- **Audio equalizer** (bands / presets — present in some ABS apps, requested in WebUI)
- **Chapter art / embedded artwork per chapter** display
- **Track-level management** during playback (Manage Tracks button)
- **Granular speed control** — WebUI exposes a slider with finer steps; Skald has fixed presets (1.0/1.25/1.5/2.0)
- **Cast / Chromecast / Sonos** support (no cast targets in Skald)

## 6. Sharing & Public Access

- **Media item share links** (`/share/<slug>`) — public, unauthenticated, timestamp-anchored
- **Share management dashboard** — list/revoke active shares
- **Filter library by "has active share"**
- **Public RSS feeds** for items / collections / podcasts, with custom slug + ownership metadata
- **RSS Feed Manager** dashboard
- **OPDS catalog feed** exposure

## 7. User & Auth

- **OpenID Connect (OIDC) SSO login** — Skald supports password + API key only
- **Permission mapping from OIDC claims**
- **Per-user library access assignment UI** (Skald has user CRUD, but library-access scoping per user is server-side only)
- **Tag-based per-user access restrictions** (inclusive/exclusive)
- **Change-password flow** (Skald has a stub, not implemented)
- **Guest user role** awareness

## 8. Server Administration Surfaces (intentional gaps?)

These are present in the WebUI but arguably belong to a server admin console; flagged for completeness:

- **Library creation / editing / deletion** (paths, watch folders, scan schedule)
- **Trigger full-library scan** (Skald can rescan one item, not the whole library)
- **Server settings panel** (scanner priority, metadata defaults, "prefer matched metadata", "audiobooks only")
- **Notification settings** (Apprise webhook config) — Skald has no notification surface
- **Scheduled tasks UI** (podcast cron, backup cron)
- **Backup management** — trigger, list, restore, configure retention
- **Server logs viewer** with Warn/Info/Debug filtering
- **Crash log viewer**
- **Custom metadata provider registration**

## 9. Statistics & History

- **Year-in-review / per-year stats** breakdown
- **Per-author / per-genre listening breakdowns** beyond raw totals
- **Streak / daily-goal stats** (where exposed in WebUI dashboards)

Skald has a listening sessions list and user/library stats summaries but not the deeper breakdowns.

## 10. UI / Client-Capability Gaps

- **PWA install** + responsive mobile/tablet layouts (Skald is desktop-only by design)
- **Cross-device progress sync visualization** (WebUI shows session device; Skald implicitly syncs)
- **Multi-language UI / i18n** (WebUI is localized; Skald is English-only)
- **Public landing / login page customization** (server-side branding)
- **Batch-select toolbar** on shelf (multi-select for delete/match/collection-add)
- **Drag-and-drop upload** of new audiobook folders into a library

## 11. Integrations Skald Lacks

- **Apprise notifications**
- **Home Assistant webhook**
- **Audnexus chapter/author enrichment** (Skald enriches via Open Library only)
- **Calibre / Goodreads / Kindle** community providers (via custom metadata provider API)

---

## Summary Table — Top-Level Categories

|Category|WebUI|Skald|Gap severity|
|---|---|---|---|
|Audiobook playback|Yes|Yes|minor (EQ, finer speed)|
|Podcasts|Yes|No|**major**|
|Ebook reader|Yes|No|**major**|
|Playlists|Yes|No (collections only)|moderate|
|Metadata editing|Yes|No (match only)|**major**|
|Cover finder / upload|Yes|No|moderate|
|Sharing & RSS feeds|Yes|No|moderate (server-ish)|
|OIDC SSO|Yes|No|moderate|
|Server admin (backups, scans, logs, notifications)|Yes|Partial (user CRUD only)|by-design?|
|Cast / Sonos / Chromecast|Yes|No|moderate|
|Localization|Yes|No|minor|
|Cross-device share progress|Yes (cookies)|N/A|n/a|

---

## Skald-Only Strengths (for context, not gaps)

Skald has several features the WebUI does not, worth noting so the comparison isn't one-sided:

- Native OS-keyring credential storage
- True offline downloads with local playback via LibVLC
- Offline progress queue with flush-on-reconnect
- Onyx design system with live theme/accent/scale switching, glass effect
- Native audio device selector (route output to specific device)
- Customizable keyboard shortcuts including chords
- Open Library review/rating enrichment
- 3D CoverFan / CoverMosaic shelf layouts
- Cover-progress overlay toggle
- Per-user "Continue Listening" remove action via right-click

---

## Verification

This document is the deliverable. No code changes or tests are required. To validate the gap list, cross-reference against:

- Skald source: `C:\Users\fireb\Documents\Skald\src\components\settings\` and `\src-tauri\src\commands.rs`
- ABS docs: [https://www.audiobookshelf.org/docs/](https://www.audiobookshelf.org/docs/) and the guides under `/guides/`
- ABS repo: [https://github.com/advplyr/audiobookshelf](https://github.com/advplyr/audiobookshelf) (specifically `/client/` for the Vue WebUI)