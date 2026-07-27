// socket.rs — manages the Socket.IO connection to the Audiobookshelf server.
//
// Authentication pattern (per official abs-socket-client-demo):
//   1. Connect to the server with no credentials in the connection itself
//   2. On the "connect" event, emit an "auth" event with the JWT token
//   3. ABS links the socket to the user and begins dispatching events
//
// This module is the foundation for all live sync event consumers (Phase C+).

use rust_socketio::asynchronous::{Client, ClientBuilder};
use rust_socketio::{Payload, TransportType};
use futures_util::FutureExt;
use tauri::{AppHandle, Emitter};
use std::sync::Arc;
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Public type alias
// ---------------------------------------------------------------------------

/// Shared mutable slot for the active async Socket.IO client.
/// Arc<Mutex<Option<…>>> so connect/disconnect commands on different tokio
/// tasks can safely swap the client without data races.
pub type SocketState = Arc<Mutex<Option<Client>>>;

// ---------------------------------------------------------------------------
// Forwarded event table
// ---------------------------------------------------------------------------

/// Every ABS socket event Skald re-emits to the frontend, paired with the Tauri
/// event name it arrives under. All of them are forwarded the same way — take
/// the first JSON value off the Socket.IO message and hand it over as a string —
/// so they live in a table rather than sixteen identical closures. The frontend
/// owns interpretation; nothing here parses a payload.
///
/// Verified against the ABS source at v2.36.0 (`96d4021`, 2026-07-27) by
/// enumerating every `SocketAuthority.*Emitter(...)` call site under `server/`.
/// The payload/audience notes below are from that pass — the full catalog,
/// including the events deliberately left unforwarded, is in the Socket Event
/// Coverage roadmap. Audience matters to consumers: an event the server sends
/// only to admins or only to the owning user cannot be relied on as a general
/// cache-invalidation signal.
pub const FORWARDED_EVENTS: &[(&str, &str)] = &[
    // ── Presence ────────────────────────────────────────────────────────────
    // Any user on the server connecting/disconnecting their last socket.
    // Payload is the public user object; drives the presence dots.
    ("user_online", "presence-user-online"),
    ("user_offline", "presence-user-offline"),
    // ── This user's media progress ──────────────────────────────────────────
    // Fires for progress written from ANY device (phone, web, another Skald).
    // The frontend owns de-wrapping and self-echo detection.
    ("user_item_progress_updated", "progress-updated"),
    // ── Single library items ────────────────────────────────────────────────
    // `libraryItemEmitter` — full `toOldJSONExpanded()`, sent only to clients
    // that may access the item, so no permission check is needed downstream.
    ("item_added", "library-item-added"),
    ("item_updated", "library-item-updated"),
    // `item_removed` carries at minimum `{ id, libraryId }`.
    ("item_removed", "library-item-removed"),
    // ── Batched library items ───────────────────────────────────────────────
    // `libraryItemsEmitter` — an **array** of exactly the single-item shape,
    // access-filtered per recipient. Emitted by library scans and by any edit
    // that touches many items at once (author rename, batch update), so these
    // arrive in bursts and are the reason invalidation is coalesced.
    ("items_added", "library-items-added"),
    ("items_updated", "library-items-updated"),
    // ── Collections ─────────────────────────────────────────────────────────
    // Broadcast to every client; payload is the full expanded collection on all
    // three, `_removed` included (so a consumer can name what disappeared).
    ("collection_added", "collection-added"),
    ("collection_updated", "collection-updated"),
    ("collection_removed", "collection-removed"),
    // ── Playlists ───────────────────────────────────────────────────────────
    // `clientEmitter` — sent ONLY to the playlist's owner. A playlist belongs to
    // one user, so this is same-user multi-device sync, never cross-user.
    // Payload is the full expanded playlist on all three.
    ("playlist_added", "playlist-added"),
    ("playlist_updated", "playlist-updated"),
    ("playlist_removed", "playlist-removed"),
    // ── Series ──────────────────────────────────────────────────────────────
    // `_added`/`_updated` carry the full series; `_removed` is thin —
    // `{ id, libraryId }` only.
    ("series_added", "series-added"),
    ("series_updated", "series-updated"),
    ("series_removed", "series-removed"),
    // ── Authors ─────────────────────────────────────────────────────────────
    // `_updated` carries the expanded author including `numBooks`. `_removed`
    // has TWO shapes depending on the call site — the full author from
    // AuthorController, but `{ id, libraryId }` from ApiRouter and the scanner —
    // so `id` is the only field a consumer may depend on.
    ("author_added", "author-added"),
    ("author_updated", "author-updated"),
    ("author_removed", "author-removed"),
    // ── Long-running tasks ──────────────────────────────────────────────────
    // Start/finish payloads are the full `task.toJSON()`. (Backups are NOT
    // tasks — they report via `backup_applied` — so they never appear here.)
    ("task_started", "task-started"),
    ("task_finished", "task-finished"),
    // `task_progress` is **admin-only** and, despite its name, is NOT a Task:
    // the payload is `{ libraryItemId, progress }`. It joins the task buffer on
    // `task.data.libraryItemId`, since it carries no task id.
    ("task_progress", "task-progress"),
    // ── This user's account ─────────────────────────────────────────────────
    // `clientEmitter` to the affected user only — permissions, library access,
    // and preference changes all land here as the browser-shaped user object.
    ("user_updated", "user-updated"),
    // ── Server logs ─────────────────────────────────────────────────────────
    // Only streamed after the client registers via `set_log_listener` (below),
    // which ABS enforces as admin-only.
    ("log", "server-log"),
];

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

/// Opens a Socket.IO connection to the ABS server and authenticates via the
/// "auth" event. Always tears down any existing connection first.
pub async fn connect(
    server_url: String,
    token: String,
    app: AppHandle,
    state: SocketState,
) -> Result<(), String> {
    // Tear down any existing connection before opening a new one so stale
    // sockets from a previous session or server change don't accumulate.
    disconnect(state.clone()).await;

    let mut builder = ClientBuilder::new(server_url.clone())
        // Force WebSocket transport — skip HTTP long-polling.
        .transport_type(TransportType::Websocket)
        // "init" is the ABS server's acknowledgement that the auth event was
        // accepted and the socket is now linked to the user account.
        .on("init", {
            let app = app.clone();
            move |_: Payload, _: Client| {
                let app = app.clone();
                async move {
                    let _ = app.emit("socket-authenticated", ());
                }
                .boxed()
            }
        })
        // "disconnect" fires on clean teardown or unexpected drops.
        .on("disconnect", {
            let app = app.clone();
            move |_: Payload, _: Client| {
                let app = app.clone();
                async move {
                    let _ = app.emit("socket-disconnected", ());
                }
                .boxed()
            }
        })
        ;

    // Register every verbatim-forwarded event from the table above. One closure
    // shape covers all of them, so a new event is a table row rather than
    // another forty lines that must be kept identical by hand.
    for (abs_event, tauri_event) in FORWARDED_EVENTS {
        builder = builder.on(*abs_event, {
            let app = app.clone();
            let abs_event: &'static str = abs_event;
            let tauri_event: &'static str = tauri_event;
            move |payload: Payload, _: Client| {
                let app = app.clone();
                async move {
                    // Extract the first JSON value from the Socket.IO message and
                    // re-emit it as a Tauri event for the frontend to consume.
                    if let Payload::Text(values) = payload {
                        if let Some(first) = values.first() {
                            // Debug, not info: a library scan emits `items_updated`
                            // in bursts, and this line is meant for diagnosing a
                            // surface that failed to update — not for the normal log.
                            log::debug!(target: "skald::sync", "socket event forwarded abs={abs_event} tauri={tauri_event}");
                            let _ = app.emit(tauri_event, first.to_string());
                        }
                    }
                }
                .boxed()
            }
        });
    }
    log::info!(target: "skald::sync",
        "socket live-sync registered {} forwarded events", FORWARDED_EVENTS.len());

    let client = builder
        // "reconnect" fires when the socket library re-establishes the transport
        // after a drop (network loss, sleep/wake, server restart). The server
        // assigns a new socket ID on each reconnect, so the auth event must be
        // re-emitted — without it the socket is unauthenticated and receives no
        // application events.
        .on("reconnect", {
            let app = app.clone();
            let server_url = server_url.clone();
            move |_: Payload, socket: Client| {
                let app = app.clone();
                let server_url = server_url.clone();
                async move {
                    // Wait for the socket handshake to settle before re-auth;
                    // mirrors the 500 ms delay used on initial connect.
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

                    // Refresh, don't just re-read. The drops this handler exists
                    // for — sleep/wake, a long outage — are precisely the ones
                    // that outlive an hour-long access token, and while they last
                    // no HTTP command runs to refresh it proactively. Re-reading
                    // the keyring would faithfully reload an expired token and the
                    // socket would come back unauthenticated.
                    let token = match crate::token_refresh::fresh_tokens(&server_url).await {
                        Ok(tokens) => tokens.effective().map(str::to_string),
                        Err(e) => {
                            // Session is gone (auth-expired has been emitted).
                            log::warn!(target: "skald::sync", "socket re-auth after reconnect abandoned: {e}");
                            None
                        }
                    };

                    // Emitting `auth` is what makes the new socket ID usable. If it
                    // fails — or there was no token to send — the transport is up
                    // but the socket is deaf, and saying otherwise is worse than
                    // saying nothing: `socket-reconnected` flips the Sync panel to
                    // "connected" *and* kicks off a resync, so a green indicator
                    // would sit over a socket that receives no events.
                    let reauthed = match token {
                        Some(token) => match socket.emit("auth", token).await {
                            Ok(()) => true,
                            Err(e) => {
                                log::warn!(target: "skald::sync", "socket re-auth emit failed after reconnect: {e}");
                                false
                            }
                        },
                        None => false,
                    };

                    if reauthed {
                        // Pull a fresh snapshot of library and progress so no
                        // missed events leave the UI stale. This says "auth was
                        // sent", not "auth was accepted" — the server's own `init`
                        // reply (→ socket-authenticated) remains the authoritative
                        // confirmation, and SyncSection treats this as the fallback.
                        let _ = app.emit("socket-reconnected", ());
                    } else {
                        let _ = app.emit("socket-disconnected", ());
                    }
                }
                .boxed()
            }
        })
        // "connect_error" fires when a connection attempt fails at the transport
        // level (server unreachable, TLS error, auth rejection, etc.). Forward the
        // error string to the frontend so it can track consecutive failures and
        // disable live sync automatically after a threshold is crossed.
        .on("connect_error", {
            let app = app.clone();
            move |payload: Payload, _: Client| {
                let app = app.clone();
                async move {
                    // Extract the error message from the payload. ABS sends errors
                    // as JSON text; fall back to a generic string if the shape varies.
                    let msg = if let Payload::Text(values) = payload {
                        values
                            .first()
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "connection error".to_string())
                    } else {
                        "connection error".to_string()
                    };
                    let _ = app.emit("socket-error", msg);
                }
                .boxed()
            }
        })
        // "error" catches general Socket.IO protocol errors (distinct from the
        // transport-level connect_error above; both are forwarded via separate events).
        .on("error", move |_err: Payload, _: Client| {
            async move {}
            .boxed()
        })
        // connect() resolves once the WebSocket upgrade is complete.
        .connect()
        .await
        .map_err(|e| format!("Socket.IO connect failed: {e}"))?;

    // Wait 500ms for the Socket.IO handshake to fully settle on the server
    // side before emitting the auth event.
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Emit auth as a bare string — ABS socket middleware expects the token
    // as a JSON string primitive, not wrapped in an object.
    client
        .emit("auth", token.clone())
        .await
        .map_err(|e| format!("Socket.IO auth emit failed: {e}"))?;

    // Notify the frontend that the transport layer is up and auth was sent.
    // Full confirmation arrives when "init" fires (socket-authenticated event).
    let _ = app.emit("socket-connected", ());

    // Store the live client in managed state so disconnect_socket can reach it.
    *state.lock().await = Some(client);
    Ok(())
}

// ---------------------------------------------------------------------------
// re-auth after a token rotation
// ---------------------------------------------------------------------------

/// Re-emits `auth` on the live socket with the current stored token.
///
/// The socket authenticates once, at connect. That binding survives an access
/// token expiring — ABS does not re-validate per event — but the *next* reconnect
/// would replay a dead credential, and any server-side re-check would drop us.
/// Re-authing on rotation keeps the live connection and the stored credential in
/// step. No-op when nothing is connected, which is the common case.
pub async fn reauthenticate(state: SocketState) {
    let guard = state.lock().await;
    let Some(client) = guard.as_ref() else { return };

    let Ok(Some(token)) = crate::auth::load_token() else {
        log::warn!(target: "skald::sync", "socket re-auth skipped: no stored token");
        return;
    };

    match client.emit("auth", token).await {
        Ok(()) => log::info!(target: "skald::sync", "socket re-authenticated after token refresh"),
        Err(e) => log::warn!(target: "skald::sync", "socket re-auth emit failed: {e}"),
    }
}

// ---------------------------------------------------------------------------
// disconnect
// ---------------------------------------------------------------------------

/// Tears down the active Socket.IO connection cleanly.
/// Safe to call when no connection is open.
pub async fn disconnect(state: SocketState) {
    let mut guard = state.lock().await;
    if let Some(client) = guard.take() {
        // take() leaves None in the slot, preventing a double-close.
        let _ = client.disconnect().await;
    }
}

// ---------------------------------------------------------------------------
// Log listener registration
// ---------------------------------------------------------------------------
// ABS only streams 'log' socket events to clients that have registered via
// set_log_listener (admin-enforced server-side). The Logs panel calls these
// when it opens/closes so the server isn't streaming logs to nobody.

/// Register the active socket as a log listener at `level` (LogLevel numeric:
/// TRACE=0 … FATAL=5). Errors if no socket is connected (live sync off).
pub async fn set_log_listener(state: SocketState, level: i32) -> Result<(), String> {
    let guard = state.lock().await;
    match guard.as_ref() {
        Some(client) => client
            .emit("set_log_listener", serde_json::json!(level))
            .await
            .map_err(|e| e.to_string()),
        None => Err("No active socket connection — enable live sync to stream logs".to_string()),
    }
}

/// Stop receiving 'log' events. No-op error if the socket is already gone.
pub async fn remove_log_listener(state: SocketState) -> Result<(), String> {
    let guard = state.lock().await;
    match guard.as_ref() {
        // ABS's remove_log_listener handler ignores its argument; send an empty
        // string (Strings are known to serialize cleanly through rust_socketio).
        Some(client) => client
            .emit("remove_log_listener", String::new())
            .await
            .map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::FORWARDED_EVENTS;

    /// The forwarding table is the whole contract between ABS and the frontend:
    /// a typo on either side is a surface that silently never updates, with no
    /// error anywhere to find it by. So the names are checked mechanically —
    /// spelling against the verified catalog, shape against the convention, and
    /// uniqueness so no event can quietly shadow another's registration.
    #[test]
    fn event_name_mapping_table_is_complete_and_consistent() {
        // Every ABS event name verified against the server source at v2.36.0
        // (`96d4021`). Dropping one from the table fails here rather than in the
        // field, where the only symptom is a stale pane.
        let required = [
            "user_online",
            "user_offline",
            "user_item_progress_updated",
            "item_added",
            "item_updated",
            "item_removed",
            "items_added",
            "items_updated",
            "collection_added",
            "collection_updated",
            "collection_removed",
            "playlist_added",
            "playlist_updated",
            "playlist_removed",
            "series_added",
            "series_updated",
            "series_removed",
            "author_added",
            "author_updated",
            "author_removed",
            "task_started",
            "task_finished",
            "task_progress",
            "user_updated",
            "log",
        ];
        for name in required {
            assert!(
                FORWARDED_EVENTS.iter().any(|(abs, _)| *abs == name),
                "verified ABS event `{name}` is not forwarded",
            );
        }
        assert_eq!(
            FORWARDED_EVENTS.len(),
            required.len(),
            "an event was forwarded without being added to the verified list",
        );

        for (abs, tauri) in FORWARDED_EVENTS {
            // ABS names are snake_case. The server is inconsistent about this —
            // `ereader-devices-updated` is hyphenated — so anything hyphenated
            // here is far more likely a Tauri name pasted into the wrong column
            // than a real ABS event, and is worth failing over.
            assert!(
                abs.chars().all(|c| c.is_ascii_lowercase() || c == '_') && !abs.is_empty(),
                "ABS event `{abs}` is not snake_case — is it in the right column?",
            );
            // Tauri names are kebab-case, matching the `task-started` precedent
            // every frontend listener already follows.
            assert!(
                tauri.chars().all(|c| c.is_ascii_lowercase() || c == '-') && !tauri.is_empty(),
                "Tauri event `{tauri}` is not kebab-case",
            );
        }

        // A duplicate ABS name silently replaces an earlier registration; a
        // duplicate Tauri name delivers two different events to one listener.
        for (index, (abs, tauri)) in FORWARDED_EVENTS.iter().enumerate() {
            let rest = &FORWARDED_EVENTS[index + 1..];
            assert!(!rest.iter().any(|(other, _)| other == abs), "duplicate ABS event `{abs}`");
            assert!(!rest.iter().any(|(_, other)| other == tauri), "duplicate Tauri event `{tauri}`");
        }
    }
}
