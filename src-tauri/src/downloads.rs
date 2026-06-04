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

// Resolves the downloads directory under the app's local-data folder.
// Factored here (rather than commands.rs) so session.rs can also reach it
// without a circular dependency — commands → session, session → downloads.
pub fn downloads_dir() -> Result<std::path::PathBuf, String> {
    directories::ProjectDirs::from("com", "skald", "Skald")
        .map(|dirs| dirs.data_local_dir().join("downloads"))
        .ok_or_else(|| "Could not determine downloads directory".to_string())
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

// Remove a successfully flushed entry after it has been confirmed on the server.
pub fn remove_progress_entry(downloads_dir: &Path, item_id: &str) -> Result<(), String> {
    let mut queue = load_progress_queue(downloads_dir);
    queue.retain(|e| e.item_id != item_id);
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
