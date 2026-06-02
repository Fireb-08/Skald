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

    let client = ClientBuilder::new(server_url.clone())
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
        // "user_online" fires when any user on the server connects a socket.
        // Forward the payload (user object) to the frontend so the presence
        // dots can be updated without a full HTTP round-trip.
        .on("user_online", {
            let app = app.clone();
            move |payload: Payload, _: Client| {
                let app = app.clone();
                async move {
                    // Extract the first JSON value from the Socket.IO message
                    // and re-emit it as a Tauri event for the frontend to consume.
                    if let Payload::Text(values) = payload {
                        if let Some(first) = values.first() {
                            let _ = app.emit("presence-user-online", first.to_string());
                        }
                    }
                }
                .boxed()
            }
        })
        // "user_offline" fires when a user disconnects all their sockets.
        // Same forwarding pattern as user_online.
        .on("user_offline", {
            let app = app.clone();
            move |payload: Payload, _: Client| {
                let app = app.clone();
                async move {
                    if let Payload::Text(values) = payload {
                        if let Some(first) = values.first() {
                            let _ = app.emit("presence-user-offline", first.to_string());
                        }
                    }
                }
                .boxed()
            }
        })
        // "user_item_progress_updated" fires when any of the authenticated user's
        // media progress records change — from any device (phone, web, another
        // Skald instance). Forward the raw payload to the frontend which
        // reconciles it into the local mediaProgress array.
        .on("user_item_progress_updated", {
            let app = app.clone();
            move |payload: Payload, _: Client| {
                let app = app.clone();
                async move {
                    // Extract the first JSON value and re-emit it as a Tauri event.
                    // The frontend handles de-wrapping and self-echo detection.
                    if let Payload::Text(values) = payload {
                        if let Some(first) = values.first() {
                            let _ = app.emit("progress-updated", first.to_string());
                        }
                    }
                }
                .boxed()
            }
        })
        // "error" catches transport-level failures.
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
