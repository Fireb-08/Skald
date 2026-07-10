// catalog/progress.rs — local playback progress, bookmarks, and listening
// stats. Split verbatim from catalog.rs (God-File Decomposition roadmap, L3/L7).
use super::*;

// ── Local progress (Phase 4) ──────────────────────────────────────────────────
// Local items have no server, so their playback progress lives here. Shaped as
// the frontend MediaProgress so it merges into the same `mediaProgress` state the
// ABS path populates (Pick-it-up, cover overlays, resume).

fn media_progress_json(item_id: &str, episode_id: &str, current_time: f64, duration: f64, is_finished: bool, updated_at: i64) -> Value {
    json!({
        // The id is composite for episodes so two episodes of one podcast don't
        // collide; book rows keep the bare item id (episode_id == '').
        "id": if episode_id.is_empty() { item_id.to_string() } else { format!("{item_id}-{episode_id}") },
        "libraryItemId": item_id,
        "episodeId": if episode_id.is_empty() { Value::Null } else { Value::String(episode_id.to_string()) },
        "duration": duration,
        "progress": if duration > 0.0 { current_time / duration } else { 0.0 },
        "currentTime": current_time,
        "isFinished": is_finished,
        "lastUpdate": updated_at,
    })
}

/// Upsert local playback progress for an (item, episode). `episode_id` is `None`
/// (or empty) for whole-item book progress and the episode guid/id for a podcast
/// episode. `library_id` is resolved from the items *or* podcasts table so callers
/// (e.g. the playback tick) only need the item id. The frontend merges on
/// `libraryItemId|episodeId`, so book and episode rows never collide.
pub fn set_progress(item_id: &str, episode_id: Option<&str>, current_time: f64, duration: f64, is_finished: bool) -> Result<(), String> {
    let conn = open()?;
    set_progress_conn(&conn, item_id, episode_id, current_time, duration, is_finished)
}

pub(crate) fn set_progress_conn(conn: &Connection, item_id: &str, episode_id: Option<&str>, current_time: f64, duration: f64, is_finished: bool) -> Result<(), String> {
    let ep = episode_id.unwrap_or("");
    // Books live in `items`; podcasts live in `podcasts` — try both so the
    // library_id stamp (used by list_progress for Pick-it-up) is always set.
    let library_id: String = conn
        .query_row("SELECT library_id FROM items WHERE id = ?1", params![item_id], |r| r.get(0))
        .optional()
        .map_err(|e| format!("progress lib lookup: {e}"))?
        .or_else(|| {
            conn.query_row("SELECT library_id FROM podcasts WHERE id = ?1", params![item_id], |r| r.get(0))
                .optional()
                .ok()
                .flatten()
        })
        .unwrap_or_default();
    // Preserve an existing finished flag against the playback tick's is_finished=false.
    // The tick streams forward progress and would otherwise silently un-finish a book
    // the user marked complete (or that end-of-book detection completed) while it is
    // still the active item. Keep the flag while the new position is at/after the old
    // one (normal forward play near the end); a clear backward jump (replay from the
    // start) is allowed to clear it so a re-listen tracks correctly.
    let effective_finished = if is_finished {
        true
    } else {
        let existing: Option<(f64, i64)> = conn
            .query_row(
                "SELECT \"current_time\", is_finished FROM progress WHERE item_id = ?1 AND episode_id = ?2",
                params![item_id, ep],
                |r| Ok((r.get::<_, f64>(0)?, r.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|e| format!("progress finished lookup: {e}"))?;
        matches!(existing, Some((old_ct, old_fin)) if old_fin != 0 && current_time + 1.0 >= old_ct)
    };
    conn.execute(
        // "current_time" is quoted everywhere it appears as an identifier: bare,
        // SQLite parses current_time as the CURRENT_TIME keyword (wall-clock TEXT),
        // not this column. The write column-list happens to be safe, but we quote
        // it here too so the column name is unambiguous across all statements.
        "INSERT OR REPLACE INTO progress
            (item_id, episode_id, library_id, \"current_time\", duration, is_finished, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![item_id, ep, library_id, current_time, duration, effective_finished as i64, now_ms()],
    )
    .map_err(|e| format!("set progress: {e}"))?;
    Ok(())
}

pub fn get_progress(item_id: &str, episode_id: Option<&str>) -> Result<Option<Value>, String> {
    let conn = open()?;
    get_progress_conn(&conn, item_id, episode_id)
}

pub(crate) fn get_progress_conn(conn: &Connection, item_id: &str, episode_id: Option<&str>) -> Result<Option<Value>, String> {
    let ep = episode_id.unwrap_or("");
    conn.query_row(
        // "current_time" MUST be quoted — unquoted it resolves to the CURRENT_TIME
        // keyword (wall-clock TEXT), failing the f64 read below and breaking resume.
        "SELECT \"current_time\", duration, is_finished, updated_at FROM progress WHERE item_id = ?1 AND episode_id = ?2",
        params![item_id, ep],
        |r| Ok(media_progress_json(item_id, ep, r.get::<_, f64>(0)?, r.get::<_, f64>(1)?, r.get::<_, i64>(2)? != 0, r.get::<_, i64>(3)?)),
    )
    .optional()
    .map_err(|e| format!("get progress: {e}"))
}

pub fn list_progress(library_id: &str) -> Result<Vec<Value>, String> {
    let conn = open()?;
    list_progress_conn(&conn, library_id)
}

pub(crate) fn list_progress_conn(conn: &Connection, library_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        // "current_time" MUST be quoted — unquoted it resolves to the CURRENT_TIME
        // keyword (wall-clock TEXT), failing the f64 read below so list_progress
        // errors out and Pick-it-up shows nothing for local libraries.
        .prepare("SELECT item_id, episode_id, \"current_time\", duration, is_finished, updated_at FROM progress WHERE library_id = ?1")
        .map_err(|e| format!("list progress: {e}"))?;
    let rows = stmt
        .query_map(params![library_id], |r| {
            let id: String = r.get(0)?;
            let ep: String = r.get(1)?;
            Ok(media_progress_json(&id, &ep, r.get::<_, f64>(2)?, r.get::<_, f64>(3)?, r.get::<_, i64>(4)? != 0, r.get::<_, i64>(5)?))
        })
        .map_err(|e| format!("list progress query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("list progress collect: {e}"))
}

// ── Local bookmarks (Phase 4) ─────────────────────────────────────────────────

fn bookmark_json(id: &str, item_id: &str, title: &str, time: f64) -> Value {
    json!({ "id": id, "libraryItemId": item_id, "title": title, "time": time })
}

pub fn add_bookmark(item_id: &str, title: &str, time: f64) -> Result<Value, String> {
    let conn = open()?;
    add_bookmark_conn(&conn, item_id, title, time)
}

pub(crate) fn add_bookmark_conn(conn: &Connection, item_id: &str, title: &str, time: f64) -> Result<Value, String> {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    format!("{item_id}:{time}:{}", now_ms()).hash(&mut h);
    let id = format!("bm_{:016x}", h.finish());
    conn.execute(
        "INSERT OR REPLACE INTO bookmarks (id, item_id, title, time, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, item_id, title, time, now_ms()],
    )
    .map_err(|e| format!("add bookmark: {e}"))?;
    Ok(bookmark_json(&id, item_id, title, time))
}

pub fn list_bookmarks(item_id: &str) -> Result<Vec<Value>, String> {
    let conn = open()?;
    list_bookmarks_conn(&conn, item_id)
}

pub(crate) fn list_bookmarks_conn(conn: &Connection, item_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT id, item_id, title, time FROM bookmarks WHERE item_id = ?1 ORDER BY time")
        .map_err(|e| format!("list bookmarks: {e}"))?;
    let rows = stmt
        .query_map(params![item_id], |r| {
            Ok(bookmark_json(&r.get::<_, String>(0)?, &r.get::<_, String>(1)?, &r.get::<_, String>(2)?, r.get::<_, f64>(3)?))
        })
        .map_err(|e| format!("list bookmarks query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("list bookmarks collect: {e}"))
}

pub fn delete_bookmark(id: &str) -> Result<(), String> {
    let conn = open()?;
    delete_bookmark_conn(&conn, id)
}

pub(crate) fn delete_bookmark_conn(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])
        .map_err(|e| format!("delete bookmark: {e}"))?;
    Ok(())
}

// ── Local listening stats (Local Listening Stats roadmap) ─────────────────────

/// Today's local date key ("YYYY-MM-DD") — local time, not UTC, matching both
/// the ABS stats day keys and the frontend's localDateKey().
fn local_day_key() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Resolve a human title for a listen-session row. Episodes read the episode's
/// feed title (falling back to the podcast title); books read the item's
/// metadata title. Best-effort — an unknown id leaves the title empty and the
/// UI shows "Unknown".
fn display_title_for(conn: &Connection, item_id: &str, episode_id: &str) -> String {
    if !episode_id.is_empty() {
        let ep_json: Option<String> = conn
            .query_row(
                "SELECT episode_json FROM podcast_episodes WHERE id = ?1",
                params![episode_id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        if let Some(title) = ep_json
            .and_then(|j| serde_json::from_str::<Value>(&j).ok())
            .and_then(|v| v.get("title").and_then(|t| t.as_str()).map(String::from))
        {
            return title;
        }
        // Episode row gone or unreadable — fall back to the podcast's own title.
        return conn
            .query_row("SELECT title FROM podcasts WHERE id = ?1", params![item_id], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
            .unwrap_or_default();
    }
    let item_json: Option<String> = conn
        .query_row("SELECT item_json FROM items WHERE id = ?1", params![item_id], |r| r.get(0))
        .optional()
        .ok()
        .flatten();
    item_json
        .and_then(|j| serde_json::from_str::<Value>(&j).ok())
        .and_then(|v| {
            v.pointer("/media/metadata/title")
                .and_then(|t| t.as_str())
                .map(String::from)
        })
        .unwrap_or_default()
}

/// Record local-library listening time: adds `secs` to today's day total and to
/// the given session row (creating it on first flush). Called from the playback
/// tick's periodic flush and the shutdown drain — never at 1 Hz.
pub fn add_listen_time(session_id: &str, item_id: &str, episode_id: Option<&str>, secs: f64) -> Result<(), String> {
    let conn = open()?;
    add_listen_time_conn(&conn, session_id, item_id, episode_id, secs, &local_day_key())
}

pub(crate) fn add_listen_time_conn(
    conn: &Connection,
    session_id: &str,
    item_id: &str,
    episode_id: Option<&str>,
    secs: f64,
    day: &str,
) -> Result<(), String> {
    if secs <= 0.0 {
        return Ok(());
    }
    let ep = episode_id.unwrap_or("");
    conn.execute(
        "INSERT INTO listen_days (day, time) VALUES (?1, ?2)
         ON CONFLICT(day) DO UPDATE SET time = time + excluded.time",
        params![day, secs],
    )
    .map_err(|e| format!("listen day upsert: {e}"))?;
    // The session's date follows its most recent listening — a session spanning
    // midnight lands wholly on the later day, which is cosmetic (day TOTALS are
    // per-flush accurate via listen_days above).
    let title = display_title_for(conn, item_id, ep);
    conn.execute(
        "INSERT INTO listen_sessions (id, item_id, episode_id, display_title, date, time_listening, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            time_listening = time_listening + excluded.time_listening,
            date = excluded.date, updated_at = excluded.updated_at",
        params![session_id, item_id, ep, title, day, secs, now_ms()],
    )
    .map_err(|e| format!("listen session upsert: {e}"))?;
    // Retention: recentSessions only ever shows a handful; keep the newest 100.
    // rowid breaks updated_at ties (flushes within one millisecond) so the
    // survivor set is deterministic.
    conn.execute(
        "DELETE FROM listen_sessions WHERE id NOT IN
            (SELECT id FROM listen_sessions ORDER BY updated_at DESC, rowid DESC LIMIT 100)",
        [],
    )
    .map_err(|e| format!("listen session prune: {e}"))?;
    Ok(())
}

/// Aggregate local listening stats in the UserStats shape GreetingPane already
/// consumes from GET /api/me/listening-stats (all times in SECONDS), so the
/// frontend can render or merge it with the server payload unchanged.
pub fn get_listening_stats() -> Result<Value, String> {
    let conn = open()?;
    get_listening_stats_conn(&conn)
}

pub(crate) fn get_listening_stats_conn(conn: &Connection) -> Result<Value, String> {
    let mut days = serde_json::Map::new();
    let mut total = 0.0f64;
    {
        let mut stmt = conn
            .prepare("SELECT day, time FROM listen_days")
            .map_err(|e| format!("listen days select: {e}"))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))
            .map_err(|e| format!("listen days query: {e}"))?;
        for row in rows {
            let (d, t) = row.map_err(|e| format!("listen days row: {e}"))?;
            total += t;
            days.insert(d, json!(t));
        }
    }
    let num_days = days.len();
    // Finished/listened counts come from the progress table (whole-item book
    // rows), not the pruned sessions list, so they stay accurate over time.
    let finished: i64 = conn
        .query_row("SELECT COUNT(*) FROM progress WHERE is_finished = 1 AND episode_id = ''", [], |r| r.get(0))
        .map_err(|e| format!("finished count: {e}"))?;
    let listened: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM progress WHERE episode_id = '' AND \"current_time\" > 0",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("listened count: {e}"))?;
    let mut sessions: Vec<Value> = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, item_id, display_title, date, time_listening FROM listen_sessions
                 ORDER BY updated_at DESC, rowid DESC LIMIT 10",
            )
            .map_err(|e| format!("listen sessions select: {e}"))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "libraryItemId": r.get::<_, String>(1)?,
                    "displayTitle": r.get::<_, String>(2)?,
                    "date": r.get::<_, String>(3)?,
                    "timeListening": r.get::<_, f64>(4)?,
                }))
            })
            .map_err(|e| format!("listen sessions query: {e}"))?;
        for row in rows {
            sessions.push(row.map_err(|e| format!("listen sessions row: {e}"))?);
        }
    }
    Ok(json!({
        "totalTime": total,
        "numDaysListened": num_days,
        "numBooksFinished": finished,
        "numBooksListened": listened,
        "recentSessions": sessions,
        "days": Value::Object(days),
    }))
}
