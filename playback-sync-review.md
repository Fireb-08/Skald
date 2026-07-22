# Code Review — Cross-Device Playback Sync Commits

Reviewed commits:

- `66ba6d4` — fix: protect cross-device playback progress
- `17a0664` — feat: surface cross-device playback conflicts
- `ba746fe` — feat: harden playback sync lifecycle

---

## 🔴 High — Downloaded books played *while online* freeze on the server and spam false "conflict" toasts

**Where:** `offline_flush_decision` (`src-tauri/src/commands/offline.rs:319`) combined with the frozen baseline captured in `play_local` (`src-tauri/src/session.rs`) and the 30 s flush loop (`src/App.tsx:165`).

The captured-baseline branch writes to the server **only** when the server's revision is byte-identical to the branch point:

```rust
(Some(baseline), Some(progress)) if progress.last_update == baseline => Write,
_ => PreserveServer,
```

`server_last_update` is captured once in `play_local` and is **never advanced** — the tick loop re-queues every 5 s with the same frozen `server_last_update_tick` (`src-tauri/src/session.rs:758`), and the flush command has no handle to `SessionManager` to update it. But Skald's *own* successful flush **is** a server write that moves `lastUpdate`.

### Concrete failure

Playing a downloaded ABS book with the server reachable (a normal case — downloaded ≠ offline):

1. `play_local` captures `server_last_update = L0`. Ticks queue entries with baseline `L0`.
2. **Flush #1** (+30 s): server is still `L0` → `L0 == L0` → **Write**. `update_progress` advances the server to `L1`. Entry removed.
3. Ticks keep queuing with baseline `L0` (SessionManager unchanged).
4. **Flush #2** (+60 s): server is now `L1` (Skald's own write) → `L1 != L0` → **PreserveServer**. Local progress is discarded to a stop-point, `offline-sync-conflict` fires → the user gets *"ABS had newer progress. Skald kept the server position…"*, and the server position **freezes at flush #1** for the rest of the session.

So after the first 30 s window the server never advances again, real progress is repeatedly dumped, and the user sees a recurring false cross-device conflict — the exact regression these commits set out to prevent, inverted. (The pure offline→reconnect path is fine because only *one* flush write happens.)

### Fix direction

After a successful captured-baseline write, the baseline must move forward past Skald's own write — e.g. have `update_progress` return the new `lastUpdate` and advance both the requeued entries and the live `SessionManager.local_server_last_update`, or exempt "server matches what Skald itself last wrote" from the conflict test. The invariant is that Skald's own flush must not later read as a foreign write.

---

## 🟡 Low — One removal error aborts the whole flush batch

At `src-tauri/src/commands/offline.rs:324` the preserve branch propagates with `?`:

```rust
downloads::remove_progress_entry(&dl_dir, &entry.item_id, entry.episode_id.as_deref(), entry.recorded_at)?;
```

whereas the success path right below uses `let _ =` (`src-tauri/src/commands/offline.rs:339`). A single removal failure on a preserved entry aborts the loop early — remaining entries never flush, and the `offline-progress-flushed` event at line 353 is skipped, so the Settings queue count goes stale. It also runs *after* `record_stop_point` already succeeded, so a retry double-records the stop point. Make it `let _ =` for consistency, or `continue`.

---

## Notes (not bugs)

- **Conflict feature is wired correctly.** Verified against ABS `PlaybackSessionManager.js` — both `syncSession` and `syncLocalSession` emit `user_item_progress_updated` with `sessionId` **and** `deviceDescription`, so the socket path in `src/state/useLiveSync.ts:125` does receive the fields it depends on. The self-echo guard (`eventSessionId === activeSessionId`) matches ABS's own session id.
- **Focus reconcile is silent before the first sync.** `changedAfterOurLastWrite` requires `lastSuccessfulServerSyncRef.current !== null` (`src/state/useLiveSync.ts:225`), so a genuinely newer server position from another device on a fresh launch won't raise a dialog (it still updates stored progress via `applyServerProgress`). Likely acceptable since you're not mid-playback on launch, but worth a conscious call.

---

# Follow-up Review — `c7c8cc6` reclaim Skald-owned playback sessions

Replaces the removed user-wide `close_all_open_sessions` with (a) a persistent per-installation ABS `deviceId`, and (b) a durable on-disk journal (`owned-playback-sessions.json`) of sessions this install opened, retried on startup and before each new session. **Overall the design is sound and the core ABS assumption is verified correct** — findings below are minor.

## ✅ Verified correct

- **The device auto-close mechanism works as the comment claims.** Confirmed against ABS source: `getDeviceInfo` (`PlaybackSessionManager.js`) looks up `Database.deviceModel.getOldDeviceByDeviceId(clientDeviceInfo.deviceId)` and returns the **existing** device record when the client sends a stable `deviceId`, so `deviceInfo.id` is stable across requests. The duplicate-close filter `playbackSession.userId === user.id && playbackSession.deviceId === deviceInfo.id` therefore matches this install's prior sessions and closes them, while phone/web clients (different `deviceId` → different device record) are untouched. Sending the persistent UUID in `deviceInfo.deviceId` (`src-tauri/src/api/playback.rs`) is the right hook.
- **Idempotent close is correct.** Tolerating `404` in both `close_session` and `close_session_without_sync` matches ABS's `openSessionMiddleware` (an already-closed id 404s), and the empty `{}` body preserves the CLAUDE.md "empty syncData → progress not overwritten" lesson that the removed `close_session_by_id` documented.
- **Fail-visible journaling.** If `record_owned` fails, `start_session` closes the just-opened session without a stale payload and returns `Err` (`src-tauri/src/session.rs:325`) — a reasonable trade to avoid recreating the original leak.
- **`load_result` refactor** correctly closes + de-journals + `clear_server_identity` on a player-load failure, so a failed `p.load()` no longer strands an open server session.

## 🟡 Low — a best-effort journal-prune IO error is fatal to starting playback

`start_session` propagates cleanup with `?`:

```rust
crate::session_ownership::retry_owned(&self.client, user_id, self.session_id.as_deref()).await?;
```

`retry_owned` swallows individual server-side close failures (logs and continues — correct), but `remove_owned_at(&root, &entry.session_id)?` inside its loop propagates: if an orphan is *successfully* closed on the server but the subsequent journal rewrite fails (transient disk error), `retry_owned` returns `Err`, which aborts `start_session` — so the user can't start playback even though opening the new session would have succeeded. This contradicts the adjacent comment ("ABS's stable-device cleanup remains the fallback if an individual orphan close is deferred") — cleanup is treated as fatal, not fallback. Prefer logging the prune failure and continuing.

## Notes (minor / by-design)

- **Per-play cleanup latency.** `retry_owned` runs *before* `open_session` on every `start_session`, closing each journaled orphan over the network sequentially. Normally the journal is empty (entries are removed on close), so it's a no-op — but a persistently un-closable orphan (ABS keeps erroring) adds a blocking round-trip to every play start. Errors are swallowed, so it's latency, not breakage.
- **Cross-user / changed-URL entries linger.** The journal is filtered by `(normalized server_url, user_id)`. Orphans recorded by user A are never reclaimed while user B is signed in on the same install, and entries under a previous server-URL string are stranded (http↔https, IP↔hostname). Impact is low (reclaimed when that user/URL returns), but the file can accumulate stale entries with no size bound.
- **`userId` resolution is safe.** Startup `cleanupOwnedPlaybackSessions(st.serverUrl, st.userId)` (`src/App.tsx:66`) can pass an empty `userId` on a cold start; both commands fall back to `client.get_me().await?.id`, and the effect is gated on `authToken && serverUrl`, so an unauthenticated call just rejects and is caught. The `onyx.ts` change (`me.id || userId`, update when they differ) correctly lets the server id win without looping.
