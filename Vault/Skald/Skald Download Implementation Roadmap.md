**Phase A — Download a book to disk (no playback integration yet)**

The goal is to prove the file transfer works end to end before touching playback.

- Add a Rust command that streams `GET /api/items/{id}/download` to a local file in a dedicated downloads directory under the app data folder, with the JWT in the auth header.
- Stream to disk in chunks rather than buffering the whole file in memory (audiobooks can be several GB).
- For now, trigger it from a single "Download" context menu item, write the file, and log completion.
- Verification: right-click a book, download it, confirm the file appears on disk at the expected path with the correct size.

**Phase B — Download progress and a downloads registry**

The goal is to track what is downloaded and show transfer progress.

- Report download progress from Rust to the frontend via Tauri events (bytes downloaded / total) so a progress bar can be shown.
- Maintain a persistent local registry (a JSON file or the existing storage pattern) recording which books are downloaded, their local file paths, sizes, and download date.
- Add a downloads list to the Downloads settings section, replacing the WIP placeholders we left earlier.
- Verification: download a book, watch a live progress indicator, confirm it appears in the downloads list after completion and persists across app restarts.

**Phase C — Download management**

The goal is control over downloads.

- Cancel an in-progress download (abort the stream, clean up the partial file).
- Delete a completed download (remove the file, update the registry).
- Handle failures gracefully (network drop mid-download → partial file cleaned up, registry not corrupted).
- Verification: start a download and cancel it (confirm partial file removed); delete a completed download (confirm file gone and registry updated); drop the network mid-download (confirm graceful failure).

**Phase D — Offline playback path**

The priority payload. The goal is to play a downloaded book from the local file instead of streaming.

- When a book is downloaded, the `playBook` function routes LibVLC to the local file path instead of the HTTP stream URL.
- Handle the multi-file case: audiobooks downloaded as a ZIP of multiple audio files, or a single M4B — LibVLC must play the correct local source with chapters intact.
- A visual indicator on downloaded books (a badge or icon) so the user knows which are available offline.
- Verification: download a book, disconnect from the server, and confirm it plays from the local copy with working chapters, seeking, and speed control.

**Phase E — Offline progress reconciliation**

The goal is correct progress handling when offline.

- When playing offline, progress cannot sync to the server in real time. Queue progress updates locally and sync them when the server becomes reachable again.
- On reconnect, push the queued offline progress to the server, reconciling against any server-side progress (latest position wins, or a defined merge rule).
- Skip or adapt the session sync-and-close lifecycle for offline playback since there is no live session.
- Verification: play a downloaded book offline, advance progress, reconnect, and confirm the progress syncs to the server correctly without overwriting newer server progress.

**Phase F — Storage management and settings**

The goal is to finish the Downloads settings section properly.

- Wire the Downloads settings rows: total cache size used, a list of downloaded books with individual delete buttons, and a "clear all downloads" action.
- Optionally a maximum download storage cap with oldest-first eviction — but this can be deferred if not needed.
- Verification: the Downloads settings section accurately reflects what is downloaded and its disk usage; delete and clear-all work.

**Phase G — Polish and edge cases**

- Auto-download-next-in-series (the feature we marked WIP earlier) can be built on this foundation if desired, or left deferred.
- Handle the case where a downloaded book is deleted on the server (the local copy remains playable but is flagged as no longer on the server).
- Handle disk-full conditions during download.
- Verification: edge case testing across the above.

A note on sequencing risk: Phase D (offline playback through LibVLC) is the highest-risk item, mirroring the LibVLC work from earlier. The local-file playback path may interact with the existing session lifecycle in ways that need careful handling. Phases A–C are comparatively low-risk file-transfer work that builds confidence before we reach D.