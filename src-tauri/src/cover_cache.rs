use std::path::PathBuf;

use directories::ProjectDirs;

fn cache_dir() -> Option<PathBuf> {
    ProjectDirs::from("com", "skald", "Skald")
        .map(|dirs| dirs.cache_dir().join("covers"))
}

/// Full path where the cover for `item_id` at an optional render `width` and a
/// cache-bust `version` would be stored. Sized requests use `{id}_w{width}.jpg`,
/// unsized use `{id}.jpg`; a non-zero version appends `_v{version}` so a changed
/// cover gets a brand-new path (and thus a fresh asset:// URL — appending a query
/// string instead breaks Tauri's asset protocol).
pub fn cache_path(item_id: &str, width: Option<u32>, version: u32) -> PathBuf {
    let base = match width {
        Some(w) => format!("{item_id}_w{w}"),
        None => item_id.to_string(),
    };
    let file_name = if version == 0 { format!("{base}.jpg") } else { format!("{base}_v{version}.jpg") };
    cache_dir()
        .unwrap_or_else(|| PathBuf::from("covers"))
        .join(file_name)
}

/// Returns `true` if the cover at this width/version is already on disk.
pub fn is_cached(item_id: &str, width: Option<u32>, version: u32) -> bool {
    cache_path(item_id, width, version).exists()
}

/// Write `bytes` to the cover cache, creating the directory if needed.
pub fn save_cover(item_id: &str, width: Option<u32>, version: u32, bytes: &[u8]) -> Result<(), String> {
    let path = cache_path(item_id, width, version);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Read and return cached cover bytes.
#[allow(dead_code)]
pub fn load_cover(item_id: &str, width: Option<u32>, version: u32) -> Result<Vec<u8>, String> {
    let path = cache_path(item_id, width, version);
    std::fs::read(&path).map_err(|e| format!("cover not cached for {item_id}: {e}"))
}

/// Delete every cached cover variant for `item_id` (any width/version). Called
/// after a cover changes so the next fetch re-downloads the new art. Item ids are
/// fixed-length UUIDs, so a `starts_with(id)` prefix match is unambiguous.
pub fn clear(item_id: &str) {
    let Some(dir) = cache_dir() else { return };
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(item_id) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}
