//! Stable ABS device identity and a durable journal of sessions opened by this
//! Skald installation. The journal replaces user-wide cleanup: only exact IDs
//! recorded after a successful Skald `/play` response are ever retried.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::api::AbsClient;

const IDENTITY_FILE: &str = "playback-device.json";
const JOURNAL_FILE: &str = "owned-playback-sessions.json";
static FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaybackIdentity {
    device_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedPlaybackSession {
    pub server_url: String,
    pub user_id: String,
    pub session_id: String,
    pub opened_at: i64,
}

fn normalize_server_url(server_url: &str) -> String {
    // Preserve a case-sensitive reverse-proxy path; only the trailing slash is
    // semantically irrelevant to AbsClient's base URL construction.
    server_url.trim().trim_end_matches('/').to_string()
}

fn identity_path(root: &Path) -> PathBuf {
    root.join(IDENTITY_FILE)
}

fn journal_path(root: &Path) -> PathBuf {
    root.join(JOURNAL_FILE)
}

fn preserve_corrupt(path: &Path, label: &str, error: &str) {
    let corrupt = path.with_file_name(format!(
        "{}.corrupt",
        path.file_name().and_then(|name| name.to_str()).unwrap_or(label),
    ));
    let preserved = std::fs::rename(path, &corrupt).is_ok();
    log::warn!(target: "skald::sync", "corrupt {label} reset preserved={preserved} error={error}");
}

fn save_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("Create playback state dir failed: {error}"))?;
    }
    let json = serde_json::to_vec_pretty(value).map_err(|error| format!("Serialize playback state failed: {error}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|error| format!("Write playback state failed: {error}"))?;
    std::fs::rename(&tmp, path).map_err(|error| format!("Publish playback state failed: {error}"))
}

fn device_id_at(root: &Path) -> Result<String, String> {
    let _guard = FILE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let path = identity_path(root);
    if let Ok(bytes) = std::fs::read(&path) {
        match serde_json::from_slice::<PlaybackIdentity>(&bytes) {
            Ok(identity) if uuid::Uuid::parse_str(&identity.device_id).is_ok() => return Ok(identity.device_id),
            Ok(_) => preserve_corrupt(&path, "playback device identity", "invalid UUID"),
            Err(error) => preserve_corrupt(&path, "playback device identity", &error.to_string()),
        }
    }

    let device_id = uuid::Uuid::new_v4().to_string();
    save_json(&path, &PlaybackIdentity { device_id: device_id.clone() })?;
    log::info!(target: "skald::sync", "created persistent ABS playback device identity");
    Ok(device_id)
}

fn load_journal_unlocked(root: &Path) -> Vec<OwnedPlaybackSession> {
    let path = journal_path(root);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => return Vec::new(),
    };
    match serde_json::from_slice(&bytes) {
        Ok(entries) => entries,
        Err(error) => {
            preserve_corrupt(&path, "owned playback session journal", &error.to_string());
            Vec::new()
        }
    }
}

fn save_journal_unlocked(root: &Path, entries: &[OwnedPlaybackSession]) -> Result<(), String> {
    save_json(&journal_path(root), entries)
}

fn record_owned_at(root: &Path, entry: OwnedPlaybackSession) -> Result<(), String> {
    let _guard = FILE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let mut entries = load_journal_unlocked(root);
    entries.retain(|existing| existing.session_id != entry.session_id);
    entries.push(entry);
    save_journal_unlocked(root, &entries)
}

fn remove_owned_at(root: &Path, session_id: &str) -> Result<bool, String> {
    let _guard = FILE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let mut entries = load_journal_unlocked(root);
    let original_len = entries.len();
    entries.retain(|entry| entry.session_id != session_id);
    if entries.len() == original_len {
        return Ok(false);
    }
    save_journal_unlocked(root, &entries)?;
    Ok(true)
}

fn matching_owned_at(root: &Path, server_url: &str, user_id: &str) -> Vec<OwnedPlaybackSession> {
    let _guard = FILE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let normalized = normalize_server_url(server_url);
    load_journal_unlocked(root)
        .into_iter()
        .filter(|entry| entry.server_url == normalized && entry.user_id == user_id)
        .collect()
}

pub fn device_id() -> Result<String, String> {
    device_id_at(&crate::paths::data_local_dir()?)
}

pub fn record_owned(server_url: &str, user_id: &str, session_id: &str) -> Result<(), String> {
    if user_id.trim().is_empty() {
        return Err("Cannot journal playback session without an ABS user ID".to_string());
    }
    record_owned_at(
        &crate::paths::data_local_dir()?,
        OwnedPlaybackSession {
            server_url: normalize_server_url(server_url),
            user_id: user_id.to_string(),
            session_id: session_id.to_string(),
            opened_at: chrono::Utc::now().timestamp_millis(),
        },
    )
}

pub fn remove_owned(session_id: &str) -> Result<bool, String> {
    remove_owned_at(&crate::paths::data_local_dir()?, session_id)
}

/// Retry only sessions proven to have been opened by this installation. A 404
/// is treated as success by the HTTP helper because ABS may already have closed
/// the session through its same-user/same-device startSession cleanup.
pub async fn retry_owned(
    client: &AbsClient,
    user_id: &str,
    exclude_session_id: Option<&str>,
) -> Result<u32, String> {
    let root = crate::paths::data_local_dir()?;
    let entries = matching_owned_at(&root, &client.base_url, user_id);
    let mut resolved = 0;
    for entry in entries {
        if exclude_session_id == Some(entry.session_id.as_str()) {
            continue;
        }
        match client.close_session_without_sync(&entry.session_id).await {
            Ok(()) => {
                remove_owned_at(&root, &entry.session_id)?;
                resolved += 1;
                log::info!(target: "skald::sync", "resolved Skald-owned playback session session_id={}", entry.session_id);
            }
            Err(error) => {
                log::warn!(target: "skald::sync", "Skald-owned session close deferred session_id={}: {error}", entry.session_id);
            }
        }
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_identity_is_stable_and_valid() {
        let root = tempfile::tempdir().unwrap();
        let first = device_id_at(root.path()).unwrap();
        let second = device_id_at(root.path()).unwrap();
        assert_eq!(first, second);
        assert!(uuid::Uuid::parse_str(&first).is_ok());
    }

    #[test]
    fn journal_filters_by_server_and_user_and_removes_exact_session() {
        let root = tempfile::tempdir().unwrap();
        for (server, user, session) in [
            ("http://abs.local/", "user-a", "skald-a"),
            ("http://abs.local", "user-b", "phone-shaped-but-owned-b"),
            ("http://other.local", "user-a", "other-server"),
        ] {
            record_owned_at(root.path(), OwnedPlaybackSession {
                server_url: normalize_server_url(server), user_id: user.to_string(),
                session_id: session.to_string(), opened_at: 1,
            }).unwrap();
        }

        let matched = matching_owned_at(root.path(), "http://abs.local/", "user-a");
        assert_eq!(matched.iter().map(|entry| entry.session_id.as_str()).collect::<Vec<_>>(), vec!["skald-a"]);
        assert!(remove_owned_at(root.path(), "skald-a").unwrap());
        assert!(!remove_owned_at(root.path(), "not-owned").unwrap());
        assert_eq!(matching_owned_at(root.path(), "http://abs.local", "user-b").len(), 1);
    }

    #[test]
    fn corrupt_journal_is_preserved_before_new_entries_are_written() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(journal_path(root.path()), b"not json").unwrap();
        record_owned_at(root.path(), OwnedPlaybackSession {
            server_url: "http://abs.local".to_string(), user_id: "user".to_string(),
            session_id: "session".to_string(), opened_at: 1,
        }).unwrap();
        assert!(root.path().join("owned-playback-sessions.json.corrupt").exists());
        assert_eq!(matching_owned_at(root.path(), "http://abs.local", "user").len(), 1);
    }
}
