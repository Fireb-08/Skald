## 

### Key differences from Collections



|             | Collections                    | Playlists                                         |
| ----------- | ------------------------------ | ------------------------------------------------- |
| Scope       | Library-wide (all users)       | Per-user (private)                                |
| Content     | Books only                     | Books **or** podcast episodes (not mixed)         |
| API base    | /api/libraries/:id/collections | `/api/playlists` + `/api/libraries/:id/playlists` |
| Item shape  | { id }                         | { libraryItemId, episodeId? }                     |
| Auto-delete | No                             | Yes (when emptied)                                |
| Reorder     | No                             | Yes (PATCH with full items array)                 |

---

### Phase 1 — Rust Backend (models + API + commands)

**Files:** `src-tauri/src/models.rs`, `src-tauri/src/api.rs`, `src-tauri/src/commands.rs`

**models.rs** — Add:

```
pub struct PlaylistItem {    pub libraryItemId: String,    pub episodeId: Option<String>,    pub libraryItem: Option<LibraryItem>,  // expanded}
pub struct Playlist {    pub id: String,    pub name: String,    pub description: Option<String>,    pub libraryId: String,    pub userId: String,    pub items: Vec<PlaylistItem>,    pub lastUpdate: i64,    pub createdAt: i64,}
pub struct PlaylistsResponse {    pub results: Vec<Playlist>,    pub total: u32,}
```

**api.rs** — Add 8 methods to `AbsClient`:

- `get_playlists(library_id)` → `GET /api/libraries/:id/playlists`
- `get_playlist(playlist_id)` → `GET /api/playlists/:id`
- `create_playlist(library_id, name, description?, items?)` → `POST /api/playlists`
- `update_playlist(id, name?, description?, items?)` → `PATCH /api/playlists/:id`
- `delete_playlist(id)` → `DELETE /api/playlists/:id`
- `batch_add_to_playlist(id, items)` → `POST /api/playlists/:id/batch/add`
- `batch_remove_from_playlist(id, items)` → `POST /api/playlists/:id/batch/remove`
- `create_playlist_from_collection(collection_id)` → `POST /api/playlists/collection/:id`

**commands.rs** — Expose all 8 as Tauri commands (same auth-token-load pattern as collections).

---

### Phase 2 — TypeScript API layer

**File:** `src/api/abs.ts`

- Mirror the 8 Rust types/commands as TS interfaces + invoke wrappers
- Add `PlaylistItem`, `Playlist` types (with optional `episodeId`)

---

### Phase 3 — State

**File:** `src/state/onyx.ts`

- Extend `ContextFilter` kind union: `'collection' | 'playlist'`
- Add `playlists: Playlist[]` to `OnyxState` (or keep fetch-on-mount like Collections — simpler for now)

---

### Phase 4 — PlaylistsView tab

**New file:** `src/components/shelf/tabs/PlaylistsView.tsx`  
**Modified:** `src/components/shelf/ShelfHeader.tsx`, `src/components/shelf/LibraryShelf.tsx`

`PlaylistsView` features (mirroring CollectionsView):

- Fetch playlists on mount with `getPlaylists(serverUrl, libraryId)`
- Grid (CoverMosaic) + List toggle
- Click → set `contextFilter` to `{ kind: 'playlist', playlistId }` and switch to library tab
- Search across playlist names/descriptions
- Inline **Create playlist** button (name input modal, no initial book required since items are optional on create)
- ShelfHeader: add `{ id: 'playlists', label: 'Playlists' }` to `TABS` array

---

### Phase 5 — PlaylistPicker (add-to-playlist from context menu)

**New file:** `src/components/PlaylistPicker.tsx`  
**Modified:** `src/components/shelf/buildItemContextMenu.ts`

- Right-click a book → "Add to Playlist" → modal lists user's playlists
- "New Playlist" option creates one and adds item in one flow
- Uses `batch_add_to_playlist`

---

### Phase 6 — Playlist Detail view (stretch goal)

**New file:** `src/components/shelf/PlaylistDetail.tsx`

- Dedicated view showing all items in a playlist
- Drag-to-reorder (sends PATCH with new item order)
- Remove individual items (with auto-delete awareness)
- Rename / edit description inline
- "Play All" button (sequential playback through items)

---

### Complexity estimate

|Phase|Complexity|Est. scope|
|---|---|---|
|1 — Rust backend|Low-medium|~200 lines, pure boilerplate following collections pattern|
|2 — TS API layer|Low|~80 lines|
|3 — State|Trivial|~10 lines|
|4 — PlaylistsView|Medium|~250 lines, clone of CollectionsView|
|5 — PlaylistPicker|Medium|~150 lines, clone of CollectionPicker|
|6 — Detail + reorder|High|~300 lines, new drag UX|

**Recommended order:** Phases 1–5 give a fully usable playlist feature. Phase 6 (drag reorder + play-all) is the only genuinely new UX surface.