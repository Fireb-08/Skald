// downloads.rs — persistent registry of books downloaded for offline use.
// Written as a JSON file in the downloads directory alongside the audio files.
// Phase D will read this registry to route LibVLC to local files instead of
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

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub item_id: String,
    pub title: String,
    pub author: String,
    pub file_path: String,  // absolute path to the downloaded audio file on disk
    pub file_size: u64,     // bytes — used to compute storage totals in the UI
    pub downloaded_at: i64, // Unix timestamp ms — shown as relative time in the Downloads list
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

// Remove a record by item_id.
// No-op and not an error if the id is not in the registry.
pub fn remove_record(downloads_dir: &Path, item_id: &str) -> Result<(), String> {
    let mut records = load_registry(downloads_dir);
    records.retain(|r| r.item_id != item_id);
    save_registry(downloads_dir, &records)
}
