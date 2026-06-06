# Fixes
* The VLC media player takes too long to load on startup
* 
# Bugs
- 

- The in focus view should always lead to the currently playing book's view





# Items that need claude design touches
	- 
	- match page
	- add to collection page
	- Context menu
	- Files context menu
	- mini player
- Build a want to read

**1. Expression that produces the count when tab is "Series" — [ShelfHeader.tsx:127](vscode-webview://1ak4tklovn2bv6jn0udrup2vms4f43imktbg825dh2euooqa3n1k/src/components/shelf/ShelfHeader.tsx#L127):**

```ts
const n = new Set(st.library.map(b => seriesNameOf(b)).filter(Boolean)).size;
return `${n} series`;
```

**2. What it reads from:** `st.library` — the full flat library array. It extracts series names from each book (via `seriesNameOf`, which reads `b.media.metadata.series` or falls back to the `seriesName` string), deduplicates them into a `Set`, and takes `.size`. It does **not** use any fetched series list — it counts distinct series names derived entirely from the book metadata already in state.

**3. Is the fetched series data from SeriesView accessible here?** No. `ShelfHeader` only receives `{ st: OnyxState }` and computes the count independently. `SeriesView`'s `fetchedSeries` / `seriesList` (fetched via `get_series_list` or similar) is local state inside the `SeriesView` component and never flows up to `ShelfHeader`. The two counts are computed from different sources and can disagree if the server's series list differs from what can be inferred from book metadata.