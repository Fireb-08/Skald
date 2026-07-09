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

// Load the registry from disk, returning an empty vec if it does not exist or is unparseable.
// A missing file is the normal state on first run and is not an error.
pub fn load_registry(downloads_dir: &Path) -> Vec<DownloadRecord> {
    let path = downloads_dir.join(REGISTRY_FILE);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return Vec::new(), // file missing or unreadable — treat as empty registry
    };
    // Corrupt JSON falls back to empty rather than propagating an error; the next
    // successful write will overwrite the corrupt file.
    serde_json::from_slice(&bytes).unwrap_or_default()
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
    pub current_time: f64,
    pub duration: f64,
    pub progress: f64,         // 0.0–1.0 — pre-computed for the flush command
    pub is_finished: bool,
    pub recorded_at: i64,      // Unix timestamp ms — used for conflict resolution
}

// The queue is stored as a sibling to downloads.json in the downloads directory.
const PROGRESS_QUEUE_FILE: &str = "offline_progress.json";

// Serializes the queue's read-modify-write cycles. The 1 Hz playback tick
// upserts entries while a reconnect flush removes the ones it synced; without
// this lock a remove's load→save window can overlap an upsert's and silently
// drop the freshest position from the rewritten file (lost update).
static QUEUE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

// Load the progress queue from disk. Returns an empty vec if the file does not
// exist (normal on first run) or is corrupt (next write will overwrite it).
pub fn load_progress_queue(downloads_dir: &Path) -> Vec<OfflineProgressEntry> {
    let path = downloads_dir.join(PROGRESS_QUEUE_FILE);
    let bytes = match std::fs::read(&path) {
        Ok(b)  => b,
        Err(_) => return Vec::new(), // missing or unreadable — treat as empty
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
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

// Add or replace a queue entry for the given item_id — keep only the latest
// entry per book since only the most recent position matters.
pub fn upsert_progress_entry(downloads_dir: &Path, entry: OfflineProgressEntry) -> Result<(), String> {
    // Poison-tolerant: a panic elsewhere must not permanently wedge progress writes.
    let _guard = QUEUE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // Ensure the directory exists — the first offline write happens before any
    // download if the user has never downloaded a book.
    std::fs::create_dir_all(downloads_dir)
        .map_err(|e| format!("Create dir failed: {e}"))?;
    let mut queue = load_progress_queue(downloads_dir);
    // Remove any stale entry for this item before pushing the latest.
    queue.retain(|e| e.item_id != entry.item_id);
    queue.push(entry);
    save_progress_queue(downloads_dir, &queue)
}

// Remove a successfully flushed entry after it has been confirmed on the server,
// but ONLY if it hasn't been superseded since it was read (matched on recorded_at).
// The 1-second offline tick loop upserts a newer entry for the same item between
// the flush's snapshot read and this remove; matching on recorded_at ensures we
// delete exactly the entry we sent and leave any newer position for the next flush.
pub fn remove_progress_entry(downloads_dir: &Path, item_id: &str, recorded_at: i64) -> Result<(), String> {
    let _guard = QUEUE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut queue = load_progress_queue(downloads_dir);
    let before = queue.len();
    queue.retain(|e| !(e.item_id == item_id && e.recorded_at == recorded_at));
    // No match → the entry was already replaced by a newer tick write; leave it
    // queued for the next flush rather than rewriting the file unnecessarily.
    if queue.len() == before { return Ok(()); }
    save_progress_queue(downloads_dir, &queue)
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
pub fn load_stop_points(data_dir: &Path, item_id: &str) -> Vec<LocalStopPoint> {
    let path = local_log_path(data_dir, item_id);
    let bytes = match std::fs::read(&path) {
        Ok(b)  => b,
        Err(_) => return Vec::new(), // missing or unreadable — treat as no history
    };
    // Corrupt JSON falls back to empty rather than surfacing an error.
    serde_json::from_slice(&bytes).unwrap_or_default()
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
    let mut points = load_stop_points(data_dir, item_id);
    points.insert(0, LocalStopPoint {
        item_id: item_id.to_string(),
        position,
        recorded_at: chrono::Utc::now().timestamp_millis(),
    });
    // Keep only the 10 most recent entries — older history is not useful in the UI.
    points.truncate(10);
    save_stop_points(data_dir, item_id, &points)
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
            current_time: time,
            duration: 3600.0,
            progress: time / 3600.0,
            is_finished: false,
            recorded_at,
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
        remove_progress_entry(dir.path(), "a", 1).unwrap();
        let queue = load_progress_queue(dir.path());
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].current_time, 30.0);

        // Matching recorded_at removes exactly the synced entry.
        remove_progress_entry(dir.path(), "a", 9).unwrap();
        assert!(load_progress_queue(dir.path()).is_empty());
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
}
