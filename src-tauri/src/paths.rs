// paths.rs — user-relocatable storage roots (First-Launch Onboarding roadmap,
// Phase 4 / gap #1).
//
// Skald keeps two large on-disk roots: the DOWNLOADS root (offline audio files +
// the downloads registry) and the CACHE root (cover-image cache, the offline
// library cache, chapter caches). By default both live under the OS per-user
// data/cache dirs (directories::ProjectDirs). A small JSON file — paths.json in
// the app's data_local dir — persists optional per-root overrides set from
// Settings → Downloads or the onboarding folders step.
//
// downloads.rs and cover_cache.rs delegate their root resolution here, so a
// relocation set via set_downloads_override / set_cache_override is honoured
// everywhere the roots are resolved, without threading config through call sites.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Overrides {
    // Absolute paths chosen by the user. Absent / empty ⇒ use the default root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    downloads_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cache_dir: Option<String>,
}

fn project_dirs() -> Result<directories::ProjectDirs, String> {
    // Empty organization → roots live at %LOCALAPPDATA%\Skald\… (single "Skald"),
    // not the old skald\Skald. ALL three ProjectDirs call sites (here, catalog.rs,
    // eq.rs) must use the same args or the data dirs would split.
    directories::ProjectDirs::from("com", "", "Skald")
        .ok_or_else(|| "Could not resolve app directories".to_string())
}

/// Small application-owned state that must not move with downloads or cache.
pub fn data_local_dir() -> Result<PathBuf, String> {
    Ok(project_dirs()?.data_local_dir().to_path_buf())
}

fn overrides_path() -> Result<PathBuf, String> {
    Ok(project_dirs()?.data_local_dir().join("paths.json"))
}

// Corrupt / missing overrides fall back to defaults — never an error, so a bad
// file can't lock the user out of their downloads.
fn load() -> Overrides {
    overrides_path()
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn store(o: &Overrides) -> Result<(), String> {
    let path = overrides_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Create dir failed: {e}"))?;
    }
    let json = serde_json::to_string_pretty(o).map_err(|e| format!("Serialize error: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("Write error: {e}"))
}

// ── Default roots (the original, pre-override locations) ──────────────────────

pub fn default_downloads_dir() -> Result<PathBuf, String> {
    Ok(project_dirs()?.data_local_dir().join("downloads"))
}

pub fn default_cache_dir() -> Result<PathBuf, String> {
    Ok(project_dirs()?.cache_dir().to_path_buf())
}

// ── Effective roots (override if set, else default) ───────────────────────────

pub fn downloads_dir() -> Result<PathBuf, String> {
    match load().downloads_dir {
        Some(p) if !p.trim().is_empty() => Ok(PathBuf::from(p)),
        _ => default_downloads_dir(),
    }
}

pub fn cache_dir() -> Result<PathBuf, String> {
    match load().cache_dir {
        Some(p) if !p.trim().is_empty() => Ok(PathBuf::from(p)),
        _ => default_cache_dir(),
    }
}

// ── Override setters (persist only — file relocation is the caller's job) ──────

pub fn set_downloads_override(path: &str) -> Result<(), String> {
    let mut o = load();
    o.downloads_dir = Some(path.to_string());
    store(&o)
}

pub fn set_cache_override(path: &str) -> Result<(), String> {
    let mut o = load();
    o.cache_dir = Some(path.to_string());
    store(&o)
}
