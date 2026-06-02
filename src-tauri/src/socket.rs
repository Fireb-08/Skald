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

    eprintln!("[socket] connecting to {}", server_url);

    let client = ClientBuilder::new(server_url.clone())
        .transport_type(TransportType::Websocket)
        // "disconnect" fires on clean teardown or unexpected drops.
        .on("disconnect", {
            let app = app.clone();
            move |_: Payload, _: Client| {
                let app = app.clone();
                async move {
                    eprintln!("[socket] disconnected");
                    let _ = app.emit("socket-disconnected", ());
                }
                .boxed()
            }
        })
        // "error" catches transport-level failures.
        .on("error", move |err: Payload, _: Client| {
            async move {
                eprintln!("[socket] error: {:?}", err);
            }
            .boxed()
        })
        // ABS emits "init_user" after accepting the auth event — socket is now
        // linked to the user account and ready to receive events.
        .on("init_user", {
            let app = app.clone();
            move |_: Payload, _: Client| {
                let app = app.clone();
                async move {
                    eprintln!("[socket] init_user received — authenticated");
                    let _ = app.emit("socket-authenticated", ());
                }
                .boxed()
            }
        })
        .connect()
        .await
        .map_err(|e| format!("Socket.IO connect failed: {e}"))?;

    // Wait 500ms for the Socket.IO handshake to fully settle before emitting auth.
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    eprintln!("[socket] sending auth token preview: {}…", &token[..token.len().min(12)]);
    // ABS expects the auth event payload to be the bare token STRING,
    // not an object. emit("auth", token) sends it as a JSON string primitive.
    client
        .emit("auth", token.clone())
        .await
        .map_err(|e| format!("Socket.IO auth emit failed: {e}"))?;

    let _ = app.emit("socket-connected", ());

    // Store the live client in managed state so disconnect_socket can reach it.
    *state.lock().await = Some(client);

    eprintln!("[socket] connection stored in state");
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
        eprintln!("[socket] disconnecting");
        let _ = client.disconnect().await;
        eprintln!("[socket] disconnected cleanly");
    }
}
