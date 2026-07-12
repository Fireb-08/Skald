// Tauri command surface, split by feature domain (Large-File Split roadmap).
// Every command stays reachable as `commands::<name>` via the glob re-exports
// below — generate_handler! in lib.rs and check-tauri-commands.mjs both rely
// on that. The globs also re-export the hidden __cmd__ items the
// #[tauri::command] macro generates, which named re-exports would miss.
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Emitter; // .emit() on AppHandle is a trait method — must be in scope
use tokio_util::sync::CancellationToken;

use crate::{api::AbsClient, audio, auth, cover_cache, downloads, eq::EqSettings, models::{self, BackupsResponse, CustomMetadataProvider, LoggerData, NotificationSettings, NotificationsResponse, ServerSettings, TasksResponse}, paths, session::SessionManager, socket};

mod admin;
mod app;
mod collections;
mod eq;
mod files;
mod library;
mod local;
mod local_podcasts;
mod login;
mod metadata;
mod offline;
mod playback;
mod podcasts;
mod sessions;
mod sharing;
mod upload;
mod users;

pub use admin::*;
pub use app::*;
pub use collections::*;
pub use eq::*;
pub use files::*;
pub use library::*;
pub use local::*;
pub use local_podcasts::*;
pub use login::*;
pub use metadata::*;
pub use offline::*;
pub use playback::*;
pub use podcasts::*;
pub use sessions::*;
pub use sharing::*;
pub use upload::*;
pub use users::*;
