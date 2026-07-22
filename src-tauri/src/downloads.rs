// downloads.rs — persistent registry of books downloaded for offline use.
// Written as a JSON file in the downloads directory alongside the audio files.
// Phase D reads this registry to route LibVLC to local files instead of
// streaming from the server.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

// Maps item_id to a CancellationToken so any in-progress download can be
// cancelled by its item_id from the cancel_download command.
pub type DownloadCancelRegistry = Arc<Mutex<HashMap<String, CancellationToken>>>;

// Resolves the downloads directory. Delegates to the paths module so a user
// relocation (set_downloads_dir) is honoured here too; the default remains
// <data_local>/Skald/downloads. Factored here (rather than commands.rs) so
// session.rs can also reach it without a circular dependency —
// commands → session, session → downloads.
pub fn downloads_dir() -> Result<std::path::PathBuf, String> {
    crate::paths::downloads_dir()
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub item_id: String,
    pub title: String,
    pub author: String,
    pub file_path: String,  // absolute path to the downloaded audio file on disk
    pub file_size: u64,     // bytes — used to compute storage totals in the UI
    pub downloaded_at: i64, // Unix timestamp ms — shown as relative time in the Downloads list
    // True when the book has been removed from the server while the local copy still exists.
    // The user retains offline playback ability but the badge changes from brass ↓ to amber !.
    // #[serde(default)] ensures existing registry files without this field deserialise as false.
    #[serde(default)]
    pub server_deleted: bool,
}

// All registry operations read/write this single file inside the downloads directory.
const REGISTRY_FILE: &str = "downloads.json";

// ── Corrupt-file preservation (review L5/L2) ──────────────────────────────────
// Resetting a corrupt persistence file to empty keeps startup safe, but doing it
// silently made corruption indistinguishable from ordinarily-empty data — and the
// next save destroyed the only evidence. The loaders below move the bad file
// aside as `<name>.corrupt` and log a warning; user-visible resets (registry,
// offline queue) additionally queue a notice the frontend polls once after mount
// so the user learns their data was reset rather than mysteriously gone.

// Notices queued for the frontend this launch: human-readable names of the
// persistence files that were preserved as *.corrupt. Drained (not just read)
// by take_corrupt_notices so the toast fires once per incident.
static CORRUPT_NOTICES: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

// Returns and clears the corrupt-persistence notices recorded since launch.
pub fn take_corrupt_notices() -> Vec<String> {
    // Poison-tolerant like QUEUE_LOCK: a panic elsewhere must not wedge notices.
    let mut notices = CORRUPT_NOTICES.lock().unwrap_or_else(|e| e.into_inner());
    std::mem::take(&mut *notices)
}

// Parse a JSON persistence file. A missing file is the normal first-run state
// and loads silently as the default; an *unparseable* file is preserved as a
// `<name>.corrupt` sibling (overwriting any previous one) before falling back,
// so the evidence survives the next save. `what` names the file in the log and
// in the user-facing notice; pass `notify_user` for files whose reset is
// user-visible (registry, offline queue) and not for per-book internals.
fn load_json_or_preserve<T: serde::de::DeserializeOwned + Default>(
    path: &Path,
    what: &str,
    notify_user: bool,
) -> T {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return T::default(), // missing or unreadable — normal empty state
    };
    match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            let corrupt = path.with_file_name(format!(
                "{}.corrupt",
                path.file_name().and_then(|n| n.to_str()).unwrap_or("persistence.json"),
            ));
            // Rename replaces an existing .corrupt from an earlier incident —
            // the freshest evidence wins. Failure to preserve must not block the
            // safe empty fallback.
            let preserved = std::fs::rename(path, &corrupt).is_ok();
            log::warn!(
                target: "skald::downloads",
                "corrupt {what} reset to empty (preserved: {preserved}, err: {e}) — see {}",
                corrupt.display(),
            );
            if notify_user {
                let mut notices = CORRUPT_NOTICES.lock().unwrap_or_else(|p| p.into_inner());
                notices.push(what.to_string());
            }
            T::default()
        }
    }
}

// Load the registry from disk, returning an empty vec if it does not exist.
// A missing file is the normal state on first run and is not an error; a
// corrupt file is preserved as downloads.json.corrupt and reported.
pub fn load_registry(downloads_dir: &Path) -> Vec<DownloadRecord> {
    load_json_or_preserve(&downloads_dir.join(REGISTRY_FILE), "downloads registry", true)
}

// Save the registry to disk.
// Uses a write-then-rename pattern so the registry is never left in a
// half-written state if the process is killed mid-write.
pub fn save_registry(downloads_dir: &Path, records: &[DownloadRecord]) -> Result<(), String> {
    // Pretty-printed so the file is human-readable when inspecting it directly.
    let json = serde_json::to_string_pretty(records)
        .map_err(|e| format!("Serialize error: {e}"))?;
    let path = downloads_dir.join(REGISTRY_FILE);
    let tmp = downloads_dir.join("downloads.json.tmp");
    std::fs::write(&tmp, &json).map_err(|e| format!("Write error: {e}"))?;
    // Atomic rename replaces the live file in one syscall.
    std::fs::rename(&tmp, &path).map_err(|e| format!("Rename error: {e}"))?;
    Ok(())
}

// Add or replace the record for the given item_id.
// If an entry for this item already exists it is updated in place; otherwise
// it is appended, so the list stays insertion-ordered by time for Phase F.
pub fn upsert_record(downloads_dir: &Path, record: DownloadRecord) -> Result<(), String> {
    let mut records = load_registry(downloads_dir);
    match records.iter().position(|r| r.item_id == record.item_id) {
        Some(pos) => records[pos] = record,
        None => records.push(record),
    }
    save_registry(downloads_dir, &records)
}

// Update the server_deleted flag for a single registry entry without touching
// the other fields. Called when a library-item-removed socket event fires for
// a book that has a local download — the file is kept but flagged as orphaned.
pub fn set_server_deleted(downloads_dir: &Path, item_id: &str, deleted: bool) -> Result<(), String> {
    let mut records = load_registry(downloads_dir);
    // Update in place — avoids overwriting fields we don't have in this call context.
    if let Some(record) = records.iter_mut().find(|r| r.item_id == item_id) {
        record.server_deleted = deleted;
    }
    save_registry(downloads_dir, &records)
}

// Remove a record by item_id.
// No-op and not an error if the id is not in the registry.
pub fn remove_record(downloads_dir: &Path, item_id: &str) -> Result<(), String> {
    let mut records = load_registry(downloads_dir);
    records.retain(|r| r.item_id != item_id);
    save_registry(downloads_dir, &records)
}

// Drop registry records whose audio file (or book directory) no longer exists on
// disk — e.g. the user deleted it manually outside the app. The pruned registry
// is persisted so the change sticks, and the survivors are returned. This keeps
// the registry, the Downloads list, and the sidebar download count honest.
pub fn prune_missing(downloads_dir: &Path) -> Vec<DownloadRecord> {
    let records = load_registry(downloads_dir);
    let present: Vec<DownloadRecord> = records
        .iter()
        .filter(|r| Path::new(&r.file_path).exists())
        .cloned()
        .collect();
    if present.len() != records.len() {
        // Persist only when something actually changed (avoids needless writes).
        let _ = save_registry(downloads_dir, &present);
    }
    present
}

// ── Offline progress queue ────────────────────────────────────────────────────
// Stores progress updates that could not be sent to the server because the
// device was offline. Persisted to disk so they survive app restart.
// Flushed to the server via flush_offline_progress() when connectivity returns.

// OfflineProgressEntry — a progress update that could not be sent to the
// server because the device was offline. Queued to disk and flushed on reconnect.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OfflineProgressEntry {
    pub item_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_id: Option<String>,
    pub current_time: f64,
    pub duration: f64,
    pub progress: f64,         // 0.0–1.0 — pre-computed for the flush command
    pub is_finished: bool,
    pub recorded_at: i64,      // Unix timestamp ms — used for conflict resolution
    /// True when Skald captured whether ABS had progress at branch time.
    #[serde(default)]
    pub baseline_captured: bool,
    /// ABS `lastUpdate` at branch time; None means no record existed then.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_last_update: Option<i64>,
    /// Position sent by a PATCH whose authoritative revision has not yet been
    /// confirmed. Retained across newer ticks so a later snapshot can recover
    /// safely when PATCH succeeded but its immediate GET failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_confirmation_current_time: Option<f64>,
}

// The queue is stored as a sibling to downloads.json in the downloads directory.
const PROGRESS_QUEUE_FILE: &str = "offline_progress.json";

// Serializes the queue's read-modify-write cycles. The 1 Hz playback tick
// upserts entries while a reconnect flush removes the ones it synced; without
// this lock a remove's load→save window can overlap an upsert's and silently
// drop the freshest position from the rewritten file (lost update).
static QUEUE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
static STOP_POINT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

// Load the progress queue from disk. Returns an empty vec if the file does not
// exist (normal on first run); a corrupt file is preserved as
// offline_progress.json.corrupt and reported — a silently-emptied queue would
// lose unsynced listening positions with no trace.
pub fn load_progress_queue(downloads_dir: &Path) -> Vec<OfflineProgressEntry> {
    load_json_or_preserve(&downloads_dir.join(PROGRESS_QUEUE_FILE), "offline progress queue", true)
}

// Persist the progress queue to disk using a write-then-rename pattern so the
// file is never left half-written if the process is killed mid-write.
pub fn save_progress_queue(downloads_dir: &Path, queue: &[OfflineProgressEntry]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(queue)
        .map_err(|e| format!("Serialize error: {e}"))?;
    let path = downloads_dir.join(PROGRESS_QUEUE_FILE);
    let tmp  = downloads_dir.join("offline_progress.json.tmp");
    std::fs::write(&tmp, &json).map_err(|e| format!("Write error: {e}"))?;
    // Atomic rename replaces the live file in one syscall — no partial-write window.
    std::fs::rename(&tmp, &path).map_err(|e| format!("Rename error: {e}"))?;
    Ok(())
}

// Add or replace a queue entry for the same book/episode identity — keep only
// the latest position because older updates must never overwrite it later.
pub fn upsert_progress_entry(downloads_dir: &Path, mut entry: OfflineProgressEntry) -> Result<(), String> {
    // Poison-tolerant: a panic elsewhere must not permanently wedge progress writes.
    let _guard = QUEUE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // Ensure the directory exists — the first offline write happens before any
    // download if the user has never downloaded a book.
    std::fs::create_dir_all(downloads_dir)
        .map_err(|e| format!("Create dir failed: {e}"))?;
    let mut queue = load_progress_queue(downloads_dir);
    // A tick can capture the old branch revision immediately before a server
    // acknowledgement, then reach this lock afterward. Preserve the greatest
    // known revision so that delayed write cannot roll the branch backward.
    if let Some(existing) = queue.iter().find(|existing| {
        existing.item_id == entry.item_id && existing.episode_id == entry.episode_id
    }) {
        if entry.baseline_captured && existing.baseline_captured {
            entry.server_last_update = match (existing.server_last_update, entry.server_last_update) {
                (Some(existing), Some(incoming)) => Some(existing.max(incoming)),
                (Some(existing), None) => Some(existing),
                (None, incoming) => incoming,
            };
        }
        if entry.pending_confirmation_current_time.is_none() {
            entry.pending_confirmation_current_time = existing.pending_confirmation_current_time;
        }
    }
    // Book progress (episode_id=None) stays distinct from each podcast episode.
    queue.retain(|e| e.item_id != entry.item_id || e.episode_id != entry.episode_id);
    queue.push(entry);
    save_progress_queue(downloads_dir, &queue)
}

/// Apply the ABS revision assigned to a confirmed progress write. The exact
/// sent entry is removed; a newer tick for the same item remains queued and is
/// rebased onto the confirmed revision.
pub fn acknowledge_progress_write(
    downloads_dir: &Path,
    sent: &OfflineProgressEntry,
    server_last_update: i64,
    confirmed_current_time: f64,
) -> Result<(), String> {
    let _guard = QUEUE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut queue = load_progress_queue(downloads_dir);
    let Some(index) = queue.iter().position(|entry| {
        entry.item_id == sent.item_id && entry.episode_id == sent.episode_id
    }) else {
        return Ok(());
    };
    // Recovery after an interrupted confirmation may use the newest queue row,
    // whose current_time is later than the position ABS just confirmed. Only
    // remove when the confirmed payload is truly the complete queued position.
    if queue[index].recorded_at == sent.recorded_at
        && (queue[index].current_time - confirmed_current_time).abs() <= 0.5
    {
        queue.remove(index);
    } else {
        queue[index].baseline_captured = true;
        queue[index].server_last_update = Some(server_last_update);
        queue[index].pending_confirmation_current_time = None;
    }
    save_progress_queue(downloads_dir, &queue)
}

/// Persist delivery intent before issuing PATCH. If the request succeeds but
/// its confirmation GET fails, a later ABS snapshot can match this position and
/// recover the assigned revision instead of misclassifying Skald's own write.
pub fn mark_progress_write_pending(
    downloads_dir: &Path,
    sent: &OfflineProgressEntry,
) -> Result<(), String> {
    let _guard = QUEUE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut queue = load_progress_queue(downloads_dir);
    let entry = queue.iter_mut().find(|entry| {
        entry.item_id == sent.item_id && entry.episode_id == sent.episode_id
    }).ok_or_else(|| "Offline progress entry disappeared before delivery".to_string())?;
    entry.pending_confirmation_current_time = Some(sent.current_time);
    save_progress_queue(downloads_dir, &queue)
}

// Remove a successfully flushed entry after it has been confirmed on the server,
// but ONLY if it hasn't been superseded since it was read (matched on recorded_at).
// The 1-second offline tick loop upserts a newer entry for the same item between
// the flush's snapshot read and this remove; matching on recorded_at ensures we
// delete exactly the entry we sent and leave any newer position for the next flush.
pub fn remove_progress_entry(
    downloads_dir: &Path,
    item_id: &str,
    episode_id: Option<&str>,
    recorded_at: i64,
) -> Result<(), String> {
    let _guard = QUEUE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut queue = load_progress_queue(downloads_dir);
    let before = queue.len();
    queue.retain(|e| {
        !(e.item_id == item_id
            && e.episode_id.as_deref() == episode_id
            && e.recorded_at == recorded_at)
    });
    // No match → the entry was already replaced by a newer tick write; leave it
    // queued for the next flush rather than rewriting the file unnecessarily.
    if queue.len() == before { return Ok(()); }
    save_progress_queue(downloads_dir, &queue)
}

/// Persist a server-bound progress snapshot using the same durable queue as
/// downloaded playback. This is also the fallback for failed online session
/// sync/close requests, including podcast episodes.
pub fn queue_server_progress(
    downloads_dir: &Path,
    item_id: &str,
    episode_id: Option<&str>,
    current_time: f64,
    duration: f64,
) -> Result<(), String> {
    let is_finished = duration > 0.0 && current_time + 1.0 >= duration;
    upsert_progress_entry(
        downloads_dir,
        OfflineProgressEntry {
            item_id: item_id.to_string(),
            episode_id: episode_id.map(str::to_string),
            current_time,
            duration,
            progress: if duration > 0.0 { current_time / duration } else { 0.0 },
            is_finished,
            recorded_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64,
            // A failed online session write did not first capture `/api/me`.
            // Keep it on the conservative legacy timestamp comparison path.
            baseline_captured: false,
            server_last_update: None,
            pending_confirmation_current_time: None,
        },
    )
}

// ── Local playback stop-point log ─────────────────────────────────────────────
// Records the position at which the user stopped playing each book.
// Written independently of the server as a safety net against position loss.
// Each book gets its own JSON file so one book's reads/writes never touch another.

// LocalStopPoint — a single recorded stopping point for a book.
// Written independently of the server as a safety net against position loss.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalStopPoint {
    pub item_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_recorded_at: Option<i64>,
    pub position: f64,    // playback position in seconds
    pub recorded_at: i64, // Unix timestamp ms — shown as date/time in the UI
}

// Build the path for a book's stop-point log file.
// Each book uses a separate file so reads and writes are independent.
fn local_log_path(data_dir: &Path, item_id: &str) -> std::path::PathBuf {
    // Sanitize the item_id to prevent path traversal on any malformed id.
    // ABS ids are alphanumeric with hyphens/underscores; everything else becomes '_'.
    let safe_id: String = item_id
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    data_dir.join(format!("local_log_{safe_id}.json"))
}

// Load stop points for a specific book, most recent first.
// Returns an empty vec if the file does not exist (normal on first play).
// A corrupt log is preserved for diagnosis but does NOT notify the user —
// stop points are a per-book safety net, not user-facing data.
pub fn load_stop_points(data_dir: &Path, item_id: &str) -> Vec<LocalStopPoint> {
    load_json_or_preserve(&local_log_path(data_dir, item_id), "stop-point log", false)
}

// Persist the stop-point list for a book using a write-then-rename pattern
// so the file is never left half-written if the process is killed mid-write.
fn save_stop_points(data_dir: &Path, item_id: &str, points: &[LocalStopPoint]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(points)
        .map_err(|e| format!("Serialize error: {e}"))?;
    let path = local_log_path(data_dir, item_id);
    // Write to a .tmp sibling then rename to the live file atomically.
    let tmp  = path.with_extension("tmp");
    std::fs::write(&tmp, &json).map_err(|e| format!("Write error: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Rename error: {e}"))?;
    Ok(())
}

// Append a stop point for a book, keeping only the 10 most recent per book.
// Called from record_stop_point command on pause, book-switch, and app-close.
pub fn record_stop_point(data_dir: &Path, item_id: &str, position: f64) -> Result<(), String> {
    let _guard = STOP_POINT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut points = load_stop_points(data_dir, item_id);
    points.insert(0, LocalStopPoint {
        item_id: item_id.to_string(),
        source_recorded_at: None,
        position,
        recorded_at: chrono::Utc::now().timestamp_millis(),
    });
    // Keep only the 10 most recent entries — older history is not useful in the UI.
    points.truncate(10);
    save_stop_points(data_dir, item_id, &points)
}

/// Record one recovery point for a conflicted queue entry. The queue timestamp
/// is a durable idempotency key, so a later removal retry cannot duplicate it.
pub fn record_conflict_stop_point(
    data_dir: &Path,
    item_id: &str,
    position: f64,
    source_recorded_at: i64,
) -> Result<bool, String> {
    let _guard = STOP_POINT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut points = load_stop_points(data_dir, item_id);
    if points.iter().any(|point| point.source_recorded_at == Some(source_recorded_at)) {
        return Ok(false);
    }
    points.insert(0, LocalStopPoint {
        item_id: item_id.to_string(),
        source_recorded_at: Some(source_recorded_at),
        position,
        recorded_at: chrono::Utc::now().timestamp_millis(),
    });
    points.truncate(10);
    save_stop_points(data_dir, item_id, &points)?;
    Ok(true)
}

// ── Tests ─────────────────────────────────────────────────────────────────────
// Persistence regression tests (Testing Suite plan, Phase 1). Everything runs
// against a tempfile dir — never the user's real downloads folder.
#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str) -> DownloadRecord {
        DownloadRecord {
            item_id: id.to_string(),
            title: format!("Title {id}"),
            author: "Author".to_string(),
            file_path: format!("C:/nowhere/{id}.m4b"),
            file_size: 123,
            downloaded_at: 1_000,
            server_deleted: false,
        }
    }

    fn entry(id: &str, time: f64, recorded_at: i64) -> OfflineProgressEntry {
        OfflineProgressEntry {
            item_id: id.to_string(),
            episode_id: None,
            current_time: time,
            duration: 3600.0,
            progress: time / 3600.0,
            is_finished: false,
            recorded_at,
            baseline_captured: false,
            server_last_update: None,
            pending_confirmation_current_time: None,
        }
    }

    // Regression for the 2nd-pass review claim that write-temp-then-rename
    // persistence "can fail after the first save" on Windows. It cannot:
    // std::fs::rename maps to MoveFileExW + MOVEFILE_REPLACE_EXISTING, so
    // replacing the live file works on every save — proven here by saving
    // three times over the same destination.
    #[test]
    fn registry_survives_repeated_saves_over_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        upsert_record(dir.path(), record("a")).unwrap();
        upsert_record(dir.path(), record("b")).unwrap();
        upsert_record(
            dir.path(),
            DownloadRecord { title: "updated".to_string(), ..record("a") },
        )
        .unwrap();

        let out = load_registry(dir.path());
        assert_eq!(out.len(), 2, "upsert must replace, not duplicate");
        assert_eq!(out.iter().find(|r| r.item_id == "a").unwrap().title, "updated");
    }

    #[test]
    fn registry_missing_or_corrupt_file_loads_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_registry(dir.path()).is_empty(), "missing file = empty registry");

        std::fs::write(dir.path().join("downloads.json"), b"{not json!").unwrap();
        assert!(load_registry(dir.path()).is_empty(), "corrupt file = empty registry");
    }

    // Review L5: a corrupt file must be moved aside as evidence, not silently
    // destroyed by the next save.
    #[test]
    fn corrupt_registry_is_preserved_with_original_bytes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("downloads.json"), b"{not json!").unwrap();

        assert!(load_registry(dir.path()).is_empty());
        let corrupt = dir.path().join("downloads.json.corrupt");
        assert_eq!(std::fs::read(&corrupt).unwrap(), b"{not json!", "evidence preserved verbatim");
        assert!(!dir.path().join("downloads.json").exists(), "live slot cleared for the next save");

        // A later incident replaces the sibling — freshest evidence wins.
        std::fs::write(dir.path().join("downloads.json"), b"worse!").unwrap();
        assert!(load_registry(dir.path()).is_empty());
        assert_eq!(std::fs::read(&corrupt).unwrap(), b"worse!");
    }

    #[test]
    fn corrupt_queue_and_stop_points_are_preserved_healthy_files_untouched() {
        let dir = tempfile::tempdir().unwrap();

        std::fs::write(dir.path().join("offline_progress.json"), b"[broken").unwrap();
        assert!(load_progress_queue(dir.path()).is_empty());
        assert!(dir.path().join("offline_progress.json.corrupt").exists());

        std::fs::write(dir.path().join("local_log_book.json"), b"[broken").unwrap();
        assert!(load_stop_points(dir.path(), "book").is_empty());
        assert!(dir.path().join("local_log_book.json.corrupt").exists());

        // A healthy file round-trips without growing a .corrupt sibling.
        upsert_record(dir.path(), record("a")).unwrap();
        assert_eq!(load_registry(dir.path()).len(), 1);
        assert!(!dir.path().join("downloads.json.corrupt").exists());
    }

    #[test]
    fn remove_record_and_server_deleted_flag() {
        let dir = tempfile::tempdir().unwrap();
        upsert_record(dir.path(), record("a")).unwrap();
        upsert_record(dir.path(), record("b")).unwrap();

        set_server_deleted(dir.path(), "a", true).unwrap();
        let out = load_registry(dir.path());
        assert!(out.iter().find(|r| r.item_id == "a").unwrap().server_deleted);
        assert!(!out.iter().find(|r| r.item_id == "b").unwrap().server_deleted);

        remove_record(dir.path(), "a").unwrap();
        remove_record(dir.path(), "missing").unwrap(); // no-op, not an error
        let out = load_registry(dir.path());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].item_id, "b");
    }

    #[test]
    fn progress_queue_keeps_only_latest_entry_per_item() {
        let dir = tempfile::tempdir().unwrap();
        upsert_progress_entry(dir.path(), entry("a", 10.0, 1)).unwrap();
        upsert_progress_entry(dir.path(), entry("a", 20.0, 2)).unwrap();
        upsert_progress_entry(dir.path(), entry("b", 5.0, 3)).unwrap();

        let queue = load_progress_queue(dir.path());
        assert_eq!(queue.len(), 2);
        let a = queue.iter().find(|e| e.item_id == "a").unwrap();
        assert_eq!(a.current_time, 20.0, "newer tick replaces the older entry");
    }

    // The flush loop snapshots the queue, syncs to the server, then removes by
    // (item_id, recorded_at). A tick that lands between snapshot and remove
    // must survive — that's the lost-update race the QUEUE_LOCK + recorded_at
    // matching guard against.
    #[test]
    fn progress_queue_remove_spares_entries_superseded_after_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        upsert_progress_entry(dir.path(), entry("a", 10.0, 1)).unwrap();
        // A newer tick supersedes the snapshot the flush is holding…
        upsert_progress_entry(dir.path(), entry("a", 30.0, 9)).unwrap();
        // …so removing with the stale recorded_at must leave the new entry.
        remove_progress_entry(dir.path(), "a", None, 1).unwrap();
        let queue = load_progress_queue(dir.path());
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].current_time, 30.0);

        // Matching recorded_at removes exactly the synced entry.
        remove_progress_entry(dir.path(), "a", None, 9).unwrap();
        assert!(load_progress_queue(dir.path()).is_empty());
    }

    #[test]
    fn confirmed_server_write_rebases_a_superseding_tick() {
        let dir = tempfile::tempdir().unwrap();
        let mut sent = entry("a", 10.0, 1);
        sent.baseline_captured = true;
        sent.server_last_update = Some(100);
        upsert_progress_entry(dir.path(), sent.clone()).unwrap();

        // Playback advances while the HTTP write is in flight. Confirmation of
        // the older snapshot must retain this position but move its ABS revision.
        let mut superseding = entry("a", 30.0, 9);
        superseding.baseline_captured = true;
        superseding.server_last_update = Some(100);
        upsert_progress_entry(dir.path(), superseding).unwrap();
        acknowledge_progress_write(dir.path(), &sent, 101, 10.0).unwrap();

        let queue = load_progress_queue(dir.path());
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].current_time, 30.0);
        assert_eq!(queue[0].server_last_update, Some(101));

        // A tick that captured the old revision before acknowledgement must not
        // roll the durable branch revision backwards when it finally acquires
        // the queue lock.
        let mut delayed = entry("a", 31.0, 10);
        delayed.baseline_captured = true;
        delayed.server_last_update = Some(100);
        upsert_progress_entry(dir.path(), delayed).unwrap();
        assert_eq!(load_progress_queue(dir.path())[0].server_last_update, Some(101));
    }

    #[test]
    fn pending_confirmation_survives_new_ticks_until_revision_is_recovered() {
        let dir = tempfile::tempdir().unwrap();
        let mut sent = entry("a", 10.0, 1);
        sent.baseline_captured = true;
        sent.server_last_update = Some(100);
        upsert_progress_entry(dir.path(), sent.clone()).unwrap();
        mark_progress_write_pending(dir.path(), &sent).unwrap();

        let mut newer = entry("a", 20.0, 2);
        newer.baseline_captured = true;
        newer.server_last_update = Some(100);
        upsert_progress_entry(dir.path(), newer).unwrap();
        assert_eq!(load_progress_queue(dir.path())[0].pending_confirmation_current_time, Some(10.0));

        let recovery_snapshot = load_progress_queue(dir.path()).remove(0);
        acknowledge_progress_write(dir.path(), &recovery_snapshot, 101, 10.0).unwrap();
        let recovered = load_progress_queue(dir.path()).remove(0);
        assert_eq!(recovered.current_time, 20.0);
        assert_eq!(recovered.server_last_update, Some(101));
        assert_eq!(recovered.pending_confirmation_current_time, None);
    }

    #[test]
    fn progress_queue_keeps_sibling_episodes_distinct() {
        let dir = tempfile::tempdir().unwrap();
        let mut first = entry("podcast", 10.0, 1);
        first.episode_id = Some("episode-a".to_string());
        let mut second = entry("podcast", 20.0, 2);
        second.episode_id = Some("episode-b".to_string());
        upsert_progress_entry(dir.path(), first).unwrap();
        upsert_progress_entry(dir.path(), second).unwrap();

        let queue = load_progress_queue(dir.path());
        assert_eq!(queue.len(), 2);
        remove_progress_entry(dir.path(), "podcast", Some("episode-a"), 1).unwrap();
        assert_eq!(load_progress_queue(dir.path())[0].episode_id.as_deref(), Some("episode-b"));
    }

    #[test]
    fn stop_points_append_newest_first_and_cap_at_ten() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..12 {
            record_stop_point(dir.path(), "book", i as f64).unwrap();
        }
        let points = load_stop_points(dir.path(), "book");
        assert_eq!(points.len(), 10, "history capped at 10");
        assert_eq!(points[0].position, 11.0, "newest first");
    }


    #[test]
    fn conflict_stop_point_is_idempotent_for_the_same_queue_entry() {
        let dir = tempfile::tempdir().unwrap();
        assert!(record_conflict_stop_point(dir.path(), "book", 42.0, 1234).unwrap());
        assert!(!record_conflict_stop_point(dir.path(), "book", 42.0, 1234).unwrap());
        let points = load_stop_points(dir.path(), "book");
        assert_eq!(points.len(), 1);
        assert_eq!(points[0].position, 42.0);
        assert_eq!(points[0].source_recorded_at, Some(1234));
    }
}
