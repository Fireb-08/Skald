// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Everything here uses full crate::
// paths, so no shared imports from the parent module are needed.

// ── Local podcasts (Local Podcasts roadmap) ──────────────────────────────────
// Server-free podcast commands: feed preview/subscribe, episode list + download,
// per-episode settings, discovery, and OPML. All work against the SQLite catalog
// and disk; none touch an ABS server. Feed fetch/parse runs async; catalog writes
// run on a blocking thread.

/// Fetch + parse an RSS/Atom feed and return its ABS-shaped PodcastMedia
/// (`{ metadata, episodes }`) for the subscribe preview. (Phase 1.)
#[tauri::command]
pub async fn get_local_podcast_feed(feed_url: String) -> Result<serde_json::Value, String> {
    let xml = crate::podcast_feed::fetch_feed_text(&feed_url).await?;
    let feed_url2 = feed_url.clone();
    tokio::task::spawn_blocking(move || crate::podcast_feed::parse_feed(&xml, &feed_url2))
        .await
        .map_err(|e| format!("parse feed task panicked: {e}"))?
}

/// Subscribe a local podcast library to a feed: parse it, record the podcast +
/// episodes in the catalog, and download its cover art. Returns the ABS-shaped
/// podcast LibraryItem so the frontend can add it without a full reload. (Phase 2.)
#[tauri::command]
pub async fn subscribe_local_podcast(
    library_id: String,
    feed_url: String,
    auto_download: Option<bool>,
) -> Result<serde_json::Value, String> {
    let xml = crate::podcast_feed::fetch_feed_text(&feed_url).await?;
    let feed_url2 = feed_url.clone();
    let feed = tokio::task::spawn_blocking(move || crate::podcast_feed::parse_feed(&xml, &feed_url2))
        .await
        .map_err(|e| format!("parse feed task panicked: {e}"))??;

    let lib = library_id.clone();
    let fu = feed_url.clone();
    let auto = auto_download.unwrap_or(false);
    let (podcast_id, cover_dest, cover_url) = tokio::task::spawn_blocking(move || {
        crate::catalog::subscribe_podcast(&lib, &feed, &fu, auto)
    })
    .await
    .map_err(|e| format!("subscribe task panicked: {e}"))??;

    // Download the cover (best-effort) so get_local_cover can serve it.
    if let Some(url) = cover_url {
        let _ = crate::providers::download_cover(&url, std::path::Path::new(&cover_dest)).await;
    }

    // Return the freshly-stored podcast item (with assembled episodes).
    let lib2 = library_id.clone();
    let items = tokio::task::spawn_blocking(move || crate::catalog::list_podcast_items(&lib2))
        .await
        .map_err(|e| format!("list task panicked: {e}"))??;
    Ok(items.into_iter().find(|i| i.get("id").and_then(|v| v.as_str()) == Some(podcast_id.as_str())).unwrap_or(serde_json::Value::Null))
}

/// List a local library's podcasts as ABS-shaped LibraryItems (Phase 2).
#[tauri::command]
pub async fn get_local_podcast_items(library_id: String) -> Result<Vec<serde_json::Value>, String> {
    tokio::task::spawn_blocking(move || crate::catalog::list_podcast_items(&library_id))
        .await
        .map_err(|e| format!("get_local_podcast_items task panicked: {e}"))?
}

/// Downloaded episodes across a local podcast library, newest first — the local
/// equivalent of ABS recent-episodes used by the browse view (Phase 3).
#[tauri::command]
pub async fn get_local_recent_episodes(library_id: String) -> Result<Vec<serde_json::Value>, String> {
    tokio::task::spawn_blocking(move || crate::catalog::list_downloaded_episodes(&library_id))
        .await
        .map_err(|e| format!("get_local_recent_episodes task panicked: {e}"))?
}

/// Download one feed episode's enclosure into the podcast folder and mark it
/// downloaded. Resolves when the file has landed, so the frontend can play it
/// immediately (download-to-play). (Phase 3.)
#[tauri::command]
pub async fn download_local_episode(
    podcast_id: String,
    episode: serde_json::Value,
    app: tauri::AppHandle,
) -> Result<String, String> {
    crate::podcast_scheduler::download_episode(&app, &podcast_id, &episode).await
}

/// Update a local podcast's auto-download settings (Phase 4).
#[tauri::command]
pub async fn update_local_podcast_settings(
    podcast_id: String,
    auto_download: bool,
    schedule: Option<String>,
    max_new: i64,
    max_keep: i64,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        crate::catalog::update_podcast_settings(&podcast_id, auto_download, schedule.as_deref(), max_new, max_keep)
    })
    .await
    .map_err(|e| format!("update_local_podcast_settings task panicked: {e}"))?
}

/// Re-poll a podcast's feed now: upsert new episodes and return the full feed
/// episode list (Phase 4 — the manual "check new" affordance).
#[tauri::command]
pub async fn check_local_new_episodes(podcast_id: String) -> Result<serde_json::Value, String> {
    let (feed_url, _folder) = tokio::task::spawn_blocking({
        let id = podcast_id.clone();
        move || crate::catalog::podcast_feed_and_folder(&id)
    })
    .await
    .map_err(|e| format!("feed lookup task panicked: {e}"))??;

    let xml = crate::podcast_feed::fetch_feed_text(&feed_url).await?;
    let feed = tokio::task::spawn_blocking(move || crate::podcast_feed::parse_feed(&xml, &feed_url))
        .await
        .map_err(|e| format!("parse feed task panicked: {e}"))??;

    let id = podcast_id.clone();
    let episodes = feed.get("episodes").and_then(|e| e.as_array()).cloned().unwrap_or_default();
    let eps_for_upsert = episodes.clone();
    tokio::task::spawn_blocking(move || crate::catalog::upsert_episodes(&id, &eps_for_upsert))
        .await
        .map_err(|e| format!("upsert task panicked: {e}"))??;
    let _ = crate::catalog::touch_episode_check(&podcast_id);
    Ok(serde_json::json!({ "episodes": episodes }))
}

/// Unsubscribe a local podcast: remove its rows, files, and folder (Phase 2).
#[tauri::command]
pub async fn delete_local_podcast(podcast_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || crate::catalog::delete_podcast(&podcast_id))
        .await
        .map_err(|e| format!("delete_local_podcast task panicked: {e}"))?
}

/// Delete one downloaded episode's audio file and flip it back to
/// not-downloaded (Podcast Episode Context Menu roadmap). The feed row is kept
/// so guid dedupe survives; the episode's progress row is cleared. The caller
/// (episode context menu) stops playback first if this episode is playing.
#[tauri::command]
pub async fn delete_local_episode(podcast_id: String, episode_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || crate::catalog::delete_local_episode(&podcast_id, &episode_id))
        .await
        .map_err(|e| format!("delete_local_episode task panicked: {e}"))?
}

/// Search the iTunes podcast directory for discovery (Phase 5).
#[tauri::command]
pub async fn search_local_podcasts(
    query: String,
    region: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    crate::providers::search_podcasts(&query, region.as_deref()).await
}

/// Parse OPML text into a feed list (Phase 5).
#[tauri::command]
pub async fn parse_local_opml(opml_text: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || crate::podcast_feed::parse_opml(&opml_text))
        .await
        .map_err(|e| format!("parse_local_opml task panicked: {e}"))?
        .map(|feeds| serde_json::json!({ "feeds": feeds }))
}

/// Bulk-subscribe a local library to a list of feed URLs from OPML (Phase 5).
/// Best-effort per feed: one bad feed doesn't abort the batch. Returns the count
/// successfully subscribed.
#[tauri::command]
pub async fn subscribe_local_opml(
    library_id: String,
    feeds: Vec<String>,
    auto_download: Option<bool>,
) -> Result<usize, String> {
    let auto = auto_download.unwrap_or(false);
    let mut ok = 0usize;
    for feed_url in feeds {
        let parsed = match crate::podcast_feed::fetch_feed_text(&feed_url).await {
            Ok(xml) => {
                let fu = feed_url.clone();
                tokio::task::spawn_blocking(move || crate::podcast_feed::parse_feed(&xml, &fu)).await
            }
            Err(e) => { log::warn!(target: "skald::library", "opml subscribe feed FAIL host={} err={e}", crate::podcast_feed::feed_host(&feed_url)); continue; }
        };
        let feed = match parsed {
            Ok(Ok(f)) => f,
            _ => continue,
        };
        let lib = library_id.clone();
        let fu = feed_url.clone();
        let res = tokio::task::spawn_blocking(move || crate::catalog::subscribe_podcast(&lib, &feed, &fu, auto)).await;
        if let Ok(Ok((_, cover_dest, cover_url))) = res {
            if let Some(url) = cover_url {
                let _ = crate::providers::download_cover(&url, std::path::Path::new(&cover_dest)).await;
            }
            ok += 1;
        }
    }
    log::info!(target: "skald::library", "opml bulk subscribe lib={library_id} subscribed={ok}");
    Ok(ok)
}

/// Export a local podcast library's subscriptions as OPML XML text (Phase 5).
#[tauri::command]
pub async fn export_local_opml(library_id: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let items = crate::catalog::list_podcast_items(&library_id)?;
        let feeds: Vec<(String, String)> = items
            .iter()
            .filter_map(|it| {
                let meta = it.get("media").and_then(|m| m.get("metadata"))?;
                let title = meta.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let feed = meta.get("feedUrl").and_then(|v| v.as_str())?.to_string();
                Some((title, feed))
            })
            .collect();
        Ok(crate::podcast_feed::build_opml(&feeds))
    })
    .await
    .map_err(|e| format!("export_local_opml task panicked: {e}"))?
}

pub type ShortcutActionMap =
    std::sync::Arc<std::sync::RwLock<std::collections::HashMap<u32, String>>>;
