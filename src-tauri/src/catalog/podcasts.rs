// catalog/podcasts.rs — local podcast subscriptions, episode upserts and
// downloads, schedules, pruning, and deletion.
// Split verbatim from catalog.rs (God-File Decomposition roadmap, L3/L7).
use super::*;

// ── Local podcasts (Local Podcasts roadmap) ───────────────────────────────────
// A subscribed podcast is one `podcasts` row (item-level metadata + settings) plus
// N `podcast_episodes` rows. The frontend consumes an ABS-shaped podcast
// `LibraryItem` (media = PodcastMedia with an assembled `episodes[]`), so these
// functions emit/accept exactly that JSON — no special-casing in the UI.

/// Deterministic 64-bit hash of a string (FNV-free; uses the std default hasher).
fn stable_hash(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

/// Stable podcast id from its feed URL so re-subscribing the same feed is idempotent.
fn podcast_id_for(feed_url: &str) -> String {
    format!("local_pod_{:016x}", stable_hash(feed_url))
}

/// Stable episode id within a podcast, keyed on the feed identity (guid, else the
/// enclosure URL). This is the `episodeId` the frontend keys per-episode progress
/// on, so it must be stable across feed re-polls.
fn episode_id_for(podcast_id: &str, guid: &str, enclosure_url: &str) -> String {
    let key = if !guid.is_empty() { guid } else { enclosure_url };
    format!("ep_{:016x}", stable_hash(&format!("{podcast_id}|{key}")))
}

/// The feed identity of an episode JSON (guid, else enclosure URL).
fn episode_guid(ep: &Value) -> String {
    if let Some(g) = ep.get("guid").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        return g.to_string();
    }
    ep.get("enclosure")
        .and_then(|e| e.get("url"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// The auto-download/cover knobs of a podcast item JSON, named so the call
/// site reads as key = value instead of a positional literal soup.
struct PodcastItemPrefs<'a> {
    auto_download: bool,
    schedule: Option<&'a str>,
    max_new: i64,
    max_keep: i64,
    has_cover: bool,
}

/// Build the ABS-shaped podcast `LibraryItem` JSON (without episodes — the caller
/// injects the assembled list). Mirrors the shape `asPodcastItem()` reads.
fn podcast_item_json(
    id: &str,
    library_id: &str,
    folder_path: &str,
    metadata: &Value,
    prefs: PodcastItemPrefs<'_>,
) -> Value {
    let PodcastItemPrefs { auto_download, schedule, max_new, max_keep, has_cover } = prefs;
    json!({
        "id": id,
        "ino": id,
        "libraryId": library_id,
        "mediaType": "podcast",
        "localPath": folder_path,
        "hasLocalCover": has_cover,
        "media": {
            "metadata": metadata,
            "episodes": [],
            "tags": [],
            "autoDownloadEpisodes": auto_download,
            "autoDownloadSchedule": schedule,
            "maxEpisodesToKeep": max_keep,
            "maxNewEpisodesToDownload": max_new,
            "numEpisodes": 0,
        },
    })
}

/// Subscribe a local library to a podcast feed. `feed` is the parsed PodcastMedia
/// JSON (`{ metadata, episodes }`) from `podcast_feed::parse`. Inserts the podcast
/// row (idempotent on feed URL), upserts its episodes, creates the on-disk folder,
/// and returns (podcast_id, cover_dest, cover_url) so the async caller can download
/// the cover art. Blocking — call from `spawn_blocking`.
pub fn subscribe_podcast(
    library_id: &str,
    feed: &Value,
    feed_url: &str,
    auto_download: bool,
) -> Result<(String, String, Option<String>), String> {
    let conn = open()?;
    subscribe_podcast_conn(&conn, library_id, feed, feed_url, auto_download)
}

pub(crate) fn subscribe_podcast_conn(
    conn: &Connection,
    library_id: &str,
    feed: &Value,
    feed_url: &str,
    auto_download: bool,
) -> Result<(String, String, Option<String>), String> {
    let metadata = feed.get("metadata").cloned().unwrap_or_else(|| json!({}));
    let title = metadata.get("title").and_then(|v| v.as_str()).unwrap_or("Podcast").to_string();
    let cover_url = metadata
        .get("imageUrl")
        .or_else(|| metadata.get("image"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Idempotency by natural key (see create_library): reuse the stored id for
    // an already-subscribed feed so identity never depends on hash stability.
    let id: String = conn
        .query_row(
            "SELECT id FROM podcasts WHERE library_id = ?1 AND feed_url = ?2",
            params![library_id, feed_url],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("podcast lookup: {e}"))?
        .unwrap_or_else(|| podcast_id_for(feed_url));
    let root = podcasts_root(conn, library_id)?;
    let folder = root.join(ingest::sanitize_component(&title));
    std::fs::create_dir_all(&folder).map_err(|e| format!("create podcast folder: {e}"))?;
    let folder_str = folder.to_string_lossy().into_owned();
    let cover_dest = folder.join("cover.jpg").to_string_lossy().into_owned();

    // Subscribe-time defaults match the podcasts table's column DEFAULTs (3/0).
    let item = podcast_item_json(&id, library_id, &folder_str, &metadata, PodcastItemPrefs {
        auto_download,
        schedule: None,
        max_new: 3,
        max_keep: 0,
        has_cover: false,
    });
    let item_str = serde_json::to_string(&item).map_err(|e| format!("serialize podcast: {e}"))?;
    let now = now_ms();
    conn.execute(
        "INSERT INTO podcasts
            (id, library_id, feed_url, title, folder_path, item_json, auto_download, auto_download_schedule, max_new, max_keep, last_episode_check, added_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, 3, 0, 0, ?8, ?8)
         ON CONFLICT(id) DO UPDATE SET feed_url=excluded.feed_url, title=excluded.title, item_json=excluded.item_json, updated_at=excluded.updated_at",
        params![id, library_id, feed_url, title, folder_str, item_str, auto_download as i64, now],
    )
    .map_err(|e| format!("insert podcast: {e}"))?;

    if let Some(eps) = feed.get("episodes").and_then(|e| e.as_array()) {
        upsert_episodes_conn(conn, &id, eps)?;
    }
    // Host only — private feed URLs carry subscriber tokens (see feed_host).
    log::info!(target: "skald::library", "podcast subscribe lib={library_id} title={title} feed={}", crate::podcast_feed::feed_host(feed_url));
    Ok((id, cover_dest, cover_url))
}

/// Upsert feed episodes for a podcast (dedupe by guid). Never touches the
/// downloaded/audio_path columns of an existing row, so a re-poll refreshes feed
/// metadata without clobbering download state. Returns (added, total_in_feed_batch).
pub(crate) fn upsert_episodes_conn(conn: &Connection, podcast_id: &str, episodes: &[Value]) -> Result<(usize, usize), String> {
    let now = now_ms();
    let mut added = 0usize;
    for ep in episodes {
        let guid = episode_guid(ep);
        if guid.is_empty() {
            continue; // no identity → cannot dedupe; skip rather than duplicate
        }
        let enclosure_url = ep.get("enclosure").and_then(|e| e.get("url")).and_then(|v| v.as_str()).unwrap_or("");
        let ep_id = episode_id_for(podcast_id, &guid, enclosure_url);
        let pub_date = ep.get("pubDate").and_then(|v| v.as_str()).unwrap_or("");
        let published_at = ep.get("publishedAt").and_then(|v| v.as_i64()).unwrap_or(0);
        let ep_str = serde_json::to_string(ep).map_err(|e| format!("serialize episode: {e}"))?;
        let changed = conn.execute(
            "INSERT INTO podcast_episodes (id, podcast_id, guid, episode_json, audio_path, downloaded, pub_date, published_at, added_at)
             VALUES (?1, ?2, ?3, ?4, NULL, 0, ?5, ?6, ?7)
             ON CONFLICT(podcast_id, guid) DO UPDATE SET episode_json=excluded.episode_json, pub_date=excluded.pub_date, published_at=excluded.published_at",
            params![ep_id, podcast_id, guid, ep_str, pub_date, published_at, now],
        )
        .map_err(|e| format!("upsert episode: {e}"))?;
        // execute returns rows-changed; an INSERT counts 1, an UPDATE-on-conflict
        // also counts 1, so distinguish a genuine add via a pre-check would cost a
        // query — instead count inserts by checking existence cheaply.
        if changed == 1 {
            // Heuristic: treat as added only if the row had no prior download state.
            added += 1;
        }
    }
    let total = conn
        .query_row("SELECT COUNT(*) FROM podcast_episodes WHERE podcast_id = ?1", params![podcast_id], |r| r.get::<_, i64>(0))
        .map_err(|e| format!("episode count: {e}"))? as usize;
    log::info!(target: "skald::library", "episodes upsert podcast={podcast_id} batch={} total={total}", episodes.len());
    Ok((added, total))
}

/// Public episode-upsert used by feed re-polls (check-new / scheduler).
pub fn upsert_episodes(podcast_id: &str, episodes: &[Value]) -> Result<(usize, usize), String> {
    let conn = open()?;
    upsert_episodes_conn(&conn, podcast_id, episodes)
}

/// Assemble one episode's frontend JSON: the stored feed JSON, plus the catalog's
/// id/podcastId and (when downloaded) a `localPath` the play command resolves and
/// a truthy `audioFile` marker so the UI treats it as playable.
fn assemble_episode(ep_id: &str, podcast_id: &str, episode_json: &str, downloaded: bool, audio_path: Option<&str>) -> Option<Value> {
    let mut ep: Value = serde_json::from_str(episode_json).ok()?;
    if let Some(obj) = ep.as_object_mut() {
        obj.insert("id".into(), Value::String(ep_id.to_string()));
        obj.insert("podcastId".into(), Value::String(podcast_id.to_string()));
        if downloaded {
            if let Some(p) = audio_path {
                obj.insert("localPath".into(), Value::String(p.to_string()));
                obj.insert("audioFile".into(), Value::Bool(true));
            }
        }
    }
    Some(ep)
}

/// Downloaded episodes of a podcast, newest first, frontend-shaped. Mirrors ABS,
/// where a podcast library item carries only its *downloaded* episodes — the full
/// published list is resolved separately from the live feed. Keeping this to
/// downloaded rows means the detail/browse views correctly mark playability.
fn podcast_episodes(conn: &Connection, podcast_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT id, episode_json, downloaded, audio_path FROM podcast_episodes WHERE podcast_id = ?1 AND downloaded = 1 ORDER BY published_at DESC")
        .map_err(|e| format!("episodes select: {e}"))?;
    let rows = stmt
        .query_map(params![podcast_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)? != 0, r.get::<_, Option<String>>(3)?))
        })
        .map_err(|e| format!("episodes query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, json, dl, path) = row.map_err(|e| format!("episode row: {e}"))?;
        if let Some(v) = assemble_episode(&id, podcast_id, &json, dl, path.as_deref()) {
            out.push(v);
        }
    }
    Ok(out)
}

/// List a local library's podcasts as ABS-shaped podcast `LibraryItem`s, each with
/// its assembled `episodes[]` (downloaded rows flagged playable). Feeds the local
/// branch of `loadItemsForLibrary`.
pub fn list_podcast_items(library_id: &str) -> Result<Vec<Value>, String> {
    let conn = open()?;
    list_podcast_items_conn(&conn, library_id)
}

pub(crate) fn list_podcast_items_conn(conn: &Connection, library_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT id, item_json, folder_path FROM podcasts WHERE library_id = ?1 ORDER BY title")
        .map_err(|e| format!("list podcasts: {e}"))?;
    let rows = stmt
        .query_map(params![library_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })
        .map_err(|e| format!("list podcasts query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, item_str, folder) = row.map_err(|e| format!("podcast row: {e}"))?;
        let mut item: Value = match serde_json::from_str(&item_str) {
            Ok(v) => v,
            Err(e) => { log::warn!(target: "skald::library", "bad podcast item_json ({e})"); continue; }
        };
        let episodes = podcast_episodes(conn, &id)?;
        let has_cover = Path::new(&folder).join("cover.jpg").is_file();
        if let Some(media) = item.get_mut("media").and_then(|m| m.as_object_mut()) {
            let n = episodes.len();
            media.insert("episodes".into(), Value::Array(episodes));
            media.insert("numEpisodes".into(), json!(n));
        }
        if let Some(obj) = item.as_object_mut() {
            obj.insert("hasLocalCover".into(), Value::Bool(has_cover));
        }
        out.push(item);
    }
    Ok(out)
}

/// Downloaded episodes across a local library, newest first, shaped like ABS
/// recent-episodes entries (carry `libraryItemId` + `episodeId`) so the browse
/// view can mark/match playable episodes. Only downloaded episodes are returned.
pub fn list_downloaded_episodes(library_id: &str) -> Result<Vec<Value>, String> {
    let conn = open()?;
    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.podcast_id, e.episode_json, e.audio_path, p.item_json
             FROM podcast_episodes e JOIN podcasts p ON p.id = e.podcast_id
             WHERE p.library_id = ?1 AND e.downloaded = 1
             ORDER BY e.published_at DESC",
        )
        .map_err(|e| format!("downloaded episodes: {e}"))?;
    let rows = stmt
        .query_map(params![library_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| format!("downloaded episodes query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (ep_id, pod_id, ep_json, audio, item_json) = row.map_err(|e| format!("dl ep row: {e}"))?;
        let Some(mut ep) = assemble_episode(&ep_id, &pod_id, &ep_json, true, audio.as_deref()) else { continue };
        let pod_meta = serde_json::from_str::<Value>(&item_json)
            .ok()
            .and_then(|v| v.get("media").and_then(|m| m.get("metadata")).cloned());
        if let Some(obj) = ep.as_object_mut() {
            obj.insert("libraryItemId".into(), Value::String(pod_id.clone()));
            obj.insert("podcast".into(), json!({ "metadata": pod_meta }));
        }
        out.push(ep);
    }
    Ok(out)
}

/// Look up a downloaded episode's on-disk audio path by podcast + episode id.
pub fn episode_audio_path(podcast_id: &str, episode_id: &str) -> Result<Option<String>, String> {
    let conn = open()?;
    conn.query_row(
        "SELECT audio_path FROM podcast_episodes WHERE podcast_id = ?1 AND id = ?2 AND downloaded = 1",
        params![podcast_id, episode_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .optional()
    .map(|o| o.flatten())
    .map_err(|e| format!("episode audio path: {e}"))
}

/// Mark an episode downloaded: store its audio path and flip the flag. Matched by
/// the feed guid so the download command (which works from the feed episode) can
/// land it on the right row.
pub fn set_episode_downloaded(podcast_id: &str, guid: &str, audio_path: &str) -> Result<(), String> {
    let conn = open()?;
    set_episode_downloaded_conn(&conn, podcast_id, guid, audio_path)
}

pub(crate) fn set_episode_downloaded_conn(conn: &Connection, podcast_id: &str, guid: &str, audio_path: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE podcast_episodes SET audio_path = ?1, downloaded = 1 WHERE podcast_id = ?2 AND guid = ?3",
        params![audio_path, podcast_id, guid],
    )
    .map_err(|e| format!("mark episode downloaded: {e}"))?;
    Ok(())
}

/// A podcast's feed URL + on-disk folder (used by the download + scheduler paths).
pub fn podcast_feed_and_folder(podcast_id: &str) -> Result<(String, String), String> {
    let conn = open()?;
    conn.query_row(
        "SELECT feed_url, folder_path FROM podcasts WHERE id = ?1",
        params![podcast_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    )
    .map_err(|e| format!("podcast feed/folder: {e}"))
}

/// Update a podcast's auto-download settings (mirrors the ABS PATCH …/media path).
/// Re-stamps the stored item_json so a subsequent list reflects the new settings.
pub fn update_podcast_settings(
    podcast_id: &str,
    auto_download: bool,
    schedule: Option<&str>,
    max_new: i64,
    max_keep: i64,
) -> Result<Value, String> {
    let conn = open()?;
    conn.execute(
        "UPDATE podcasts SET auto_download = ?1, auto_download_schedule = ?2, max_new = ?3, max_keep = ?4, updated_at = ?5 WHERE id = ?6",
        params![auto_download as i64, schedule, max_new, max_keep, now_ms(), podcast_id],
    )
    .map_err(|e| format!("update podcast settings: {e}"))?;
    // Re-stamp item_json so its embedded settings stay in sync with the columns.
    let item_str: String = conn
        .query_row("SELECT item_json FROM podcasts WHERE id = ?1", params![podcast_id], |r| r.get(0))
        .map_err(|e| format!("reload podcast: {e}"))?;
    let mut item: Value = serde_json::from_str(&item_str).map_err(|e| format!("parse podcast: {e}"))?;
    if let Some(media) = item.get_mut("media").and_then(|m| m.as_object_mut()) {
        media.insert("autoDownloadEpisodes".into(), json!(auto_download));
        media.insert("autoDownloadSchedule".into(), schedule.map(|s| json!(s)).unwrap_or(Value::Null));
        media.insert("maxNewEpisodesToDownload".into(), json!(max_new));
        media.insert("maxEpisodesToKeep".into(), json!(max_keep));
    }
    let updated = serde_json::to_string(&item).map_err(|e| format!("serialize podcast: {e}"))?;
    conn.execute("UPDATE podcasts SET item_json = ?1 WHERE id = ?2", params![updated, podcast_id])
        .map_err(|e| format!("save podcast item_json: {e}"))?;
    Ok(item)
}

/// Settings row for one podcast (used by the auto-download scheduler).
pub struct PodcastSchedule {
    pub id: String,
    pub feed_url: String,
    pub auto_download: bool,
    pub schedule: Option<String>,
    pub max_new: i64,
    pub max_keep: i64,
    pub last_check: i64,
}

/// All podcasts that have auto-download enabled, across all libraries (scheduler).
pub fn list_auto_download_podcasts() -> Result<Vec<PodcastSchedule>, String> {
    let conn = open()?;
    let mut stmt = conn
        .prepare("SELECT id, feed_url, auto_download, auto_download_schedule, max_new, max_keep, last_episode_check FROM podcasts WHERE auto_download = 1")
        .map_err(|e| format!("list auto podcasts: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(PodcastSchedule {
                id: r.get(0)?,
                feed_url: r.get(1)?,
                auto_download: r.get::<_, i64>(2)? != 0,
                schedule: r.get(3)?,
                max_new: r.get(4)?,
                max_keep: r.get(5)?,
                last_check: r.get(6)?,
            })
        })
        .map_err(|e| format!("auto podcasts query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("auto podcasts collect: {e}"))
}

/// Stamp a podcast's last-feed-check time (scheduler bookkeeping).
pub fn touch_episode_check(podcast_id: &str) -> Result<(), String> {
    let conn = open()?;
    conn.execute("UPDATE podcasts SET last_episode_check = ?1 WHERE id = ?2", params![now_ms(), podcast_id])
        .map_err(|e| format!("touch episode check: {e}"))?;
    Ok(())
}

/// The undownloaded episodes of a podcast, newest first (scheduler picks the
/// newest `max_new` to fetch). Returns (episode_json, guid) pairs.
pub fn undownloaded_episodes(podcast_id: &str, limit: usize) -> Result<Vec<(Value, String)>, String> {
    let conn = open()?;
    let mut stmt = conn
        .prepare("SELECT episode_json, guid FROM podcast_episodes WHERE podcast_id = ?1 AND downloaded = 0 ORDER BY published_at DESC LIMIT ?2")
        .map_err(|e| format!("undownloaded select: {e}"))?;
    let rows = stmt
        .query_map(params![podcast_id, limit as i64], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("undownloaded query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (json, guid) = row.map_err(|e| format!("undownloaded row: {e}"))?;
        if let Ok(v) = serde_json::from_str::<Value>(&json) {
            out.push((v, guid));
        }
    }
    Ok(out)
}

/// Retention: keep only the newest `max_keep` downloaded episodes; delete the
/// older downloaded files + flip their rows back to not-downloaded (the feed entry
/// is kept so the episode can be re-downloaded). `max_keep <= 0` disables pruning.
/// Never deletes the currently-playing episode (caller passes its id to skip).
/// Returns the number of episodes pruned.
pub fn prune_episodes(podcast_id: &str, max_keep: i64, skip_episode_id: Option<&str>) -> Result<usize, String> {
    if max_keep <= 0 {
        return Ok(0);
    }
    let conn = open()?;
    // Downloaded episodes newest-first; everything past max_keep is a prune target.
    let mut stmt = conn
        .prepare("SELECT id, audio_path FROM podcast_episodes WHERE podcast_id = ?1 AND downloaded = 1 ORDER BY published_at DESC")
        .map_err(|e| format!("prune select: {e}"))?;
    let rows: Vec<(String, Option<String>)> = stmt
        .query_map(params![podcast_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))
        .map_err(|e| format!("prune query: {e}"))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("prune collect: {e}"))?;
    let mut pruned = 0usize;
    for (id, audio) in rows.into_iter().skip(max_keep as usize) {
        if Some(id.as_str()) == skip_episode_id {
            continue; // never prune the episode currently playing
        }
        if let Some(p) = audio.as_deref() {
            // Verify-before-delete: only remove a file that actually exists.
            if Path::new(p).is_file() {
                let _ = std::fs::remove_file(p);
            }
        }
        conn.execute(
            "UPDATE podcast_episodes SET downloaded = 0, audio_path = NULL WHERE id = ?1",
            params![id],
        )
        .map_err(|e| format!("prune update: {e}"))?;
        pruned += 1;
    }
    if pruned > 0 {
        log::info!(target: "skald::library", "retention prune podcast={podcast_id} removed={pruned}");
    }
    Ok(pruned)
}

/// Unsubscribe: delete a podcast, all its episode rows + downloaded files, its
/// on-disk folder, and its progress rows. Blocking — call from `spawn_blocking`.
pub fn delete_podcast(podcast_id: &str) -> Result<(), String> {
    let conn = open()?;
    let row: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT library_id, folder_path FROM podcasts WHERE id = ?1",
            params![podcast_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|e| format!("podcast folder lookup: {e}"))?;
    conn.execute("DELETE FROM podcast_episodes WHERE podcast_id = ?1", params![podcast_id])
        .map_err(|e| format!("del episodes: {e}"))?;
    conn.execute("DELETE FROM podcasts WHERE id = ?1", params![podcast_id])
        .map_err(|e| format!("del podcast: {e}"))?;
    conn.execute("DELETE FROM progress WHERE item_id = ?1", params![podcast_id])
        .map_err(|e| format!("del podcast progress: {e}"))?;
    if let Some((library_id, Some(f))) = row {
        let p = Path::new(&f);
        // Containment guard (see delete_item): only delete a folder that sits
        // strictly inside this library's root — never an arbitrary stored path.
        match library_root(&conn, &library_id) {
            Ok(root) if p.starts_with(Path::new(&root)) && p != Path::new(&root) => {
                if p.exists() {
                    let _ = std::fs::remove_dir_all(p);
                }
            }
            _ => log::warn!(target: "skald::library",
                "delete_podcast refused out-of-root folder {} (library {library_id})", p.display()),
        }
    }
    log::info!(target: "skald::library", "podcast unsubscribe id={podcast_id}");
    Ok(())
}

/// Delete one downloaded episode's audio file and return it to the
/// not-downloaded state (Podcast Episode Context Menu roadmap). The episode ROW
/// is kept — its guid powers feed dedupe; deleting it would resurrect the
/// episode as "new" on the next feed check (and auto-download could immediately
/// re-fetch it). The (podcast, episode) progress row is removed so a later
/// re-download starts clean instead of resuming a stale position.
pub fn delete_local_episode(podcast_id: &str, episode_id: &str) -> Result<(), String> {
    let conn = open()?;
    delete_local_episode_conn(&conn, podcast_id, episode_id)
}

pub(crate) fn delete_local_episode_conn(conn: &Connection, podcast_id: &str, episode_id: &str) -> Result<(), String> {
    let audio: Option<Option<String>> = conn
        .query_row(
            "SELECT audio_path FROM podcast_episodes WHERE podcast_id = ?1 AND id = ?2",
            params![podcast_id, episode_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("episode lookup: {e}"))?;
    let Some(audio) = audio else {
        return Err("episode not found".to_string());
    };
    if let Some(p) = audio.as_deref() {
        // Verify-before-delete (same rule as prune_episodes): only remove a file
        // that actually exists; already-missing is not an error. A FAILED delete
        // (e.g. a sharing violation from a player holding the handle) IS an
        // error — flipping the flag anyway would orphan the file on disk.
        if Path::new(p).is_file() {
            std::fs::remove_file(p).map_err(|e| format!("delete episode file: {e}"))?;
        }
    }
    conn.execute(
        "UPDATE podcast_episodes SET downloaded = 0, audio_path = NULL WHERE podcast_id = ?1 AND id = ?2",
        params![podcast_id, episode_id],
    )
    .map_err(|e| format!("episode delete update: {e}"))?;
    conn.execute(
        "DELETE FROM progress WHERE item_id = ?1 AND episode_id = ?2",
        params![podcast_id, episode_id],
    )
    .map_err(|e| format!("episode progress delete: {e}"))?;
    log::info!(target: "skald::downloads", "local episode delete podcast={podcast_id} episode={episode_id}");
    Ok(())
}

