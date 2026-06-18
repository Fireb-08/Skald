// watcher.rs — staging-folder file-system watcher (Local Library roadmap, Phase 7).
//
// Watches each local library's staging folder and emits a debounced
// `staging-changed` Tauri event when files appear/change/disappear, so the UI can
// refresh its "needs attention" / staging view without polling. We deliberately
// do NOT auto-move files (a drop or large copy can be mid-flight); the user
// triggers the actual ingest. The frontend coalesces the (possibly bursty) events.

use std::path::Path;
use std::sync::{Arc, Mutex};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Runtime};

/// Holds the single active watcher so it isn't dropped (dropping stops watching).
/// Replaced wholesale whenever the set of staging paths changes.
pub type StagingWatcher = Arc<Mutex<Option<RecommendedWatcher>>>;

/// (Re)start watching `paths`. Passing an empty list tears the watcher down.
pub fn start<R: Runtime>(paths: Vec<String>, app: AppHandle<R>, state: &StagingWatcher) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "watcher state poisoned".to_string())?;
    // Drop any existing watcher first (stops its threads/handles).
    *guard = None;
    if paths.is_empty() {
        return Ok(());
    }

    let app_cb = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            // React only to content-affecting changes, not bare access events.
            if matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) {
                let _ = app_cb.emit("staging-changed", ());
            }
        }
    })
    .map_err(|e| format!("create watcher: {e}"))?;

    for p in &paths {
        // Recursive so books dropped in subfolders are noticed too. Best-effort:
        // a missing/again-removed path shouldn't abort watching the others.
        if let Err(e) = watcher.watch(Path::new(p), RecursiveMode::Recursive) {
            log::warn!(target: "skald::library", "watch failed path={p} err={e}");
        }
    }
    log::info!(target: "skald::library", "staging watch active paths={}", paths.len());
    *guard = Some(watcher);
    Ok(())
}
