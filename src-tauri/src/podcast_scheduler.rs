// podcast_scheduler.rs — local podcast auto-download poll + retention.
// (Local Podcasts roadmap, Phase 4.)
//
// A single coarse tick evaluates each auto-download podcast's cron schedule and,
// when due, re-fetches the feed, upserts new episodes, downloads up to
// `max_new` of the newest undownloaded ones, then prunes to `max_keep`. This
// mirrors how ABS polls (a periodic check that evaluates due crons) rather than
// per-podcast timers. There is no server here — everything is local.

use std::path::Path;

use chrono::{Datelike, Local, Timelike};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime};

use crate::{catalog, ingest, podcast_feed};

/// Match a single cron field (minute/hour/dom/month/dow) against `v`. Supports
/// `*`, `*/N`, `a-b` ranges, `a,b` lists and plain numbers — the shapes the
/// CronEditor emits plus common hand-written ones.
fn field_matches(field: &str, v: u32) -> bool {
    field.split(',').any(|tok| {
        let tok = tok.trim();
        if tok == "*" {
            return true;
        }
        if let Some(step) = tok.strip_prefix("*/") {
            return step.parse::<u32>().map(|n| n != 0 && v % n == 0).unwrap_or(false);
        }
        if let Some((a, b)) = tok.split_once('-') {
            if let (Ok(a), Ok(b)) = (a.trim().parse::<u32>(), b.trim().parse::<u32>()) {
                return v >= a && v <= b;
            }
            return false;
        }
        tok.parse::<u32>().map(|n| n == v).unwrap_or(false)
    })
}

/// True when a 5-field cron expression (`min hour dom month dow`) fires at `dt`
/// (minute resolution). Day-of-week is 0=Sun..6=Sat. When both day-of-month and
/// day-of-week are restricted, standard cron treats them as an OR.
pub fn cron_matches(expr: &str, dt: &chrono::DateTime<Local>) -> bool {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() != 5 {
        return false;
    }
    let (min, hour, dom, mon, dow) = (parts[0], parts[1], parts[2], parts[3], parts[4]);
    let min_ok = field_matches(min, dt.minute());
    let hour_ok = field_matches(hour, dt.hour());
    let mon_ok = field_matches(mon, dt.month());
    let dom_ok = field_matches(dom, dt.day());
    let dow_ok = field_matches(dow, dt.weekday().num_days_from_sunday());

    let day_ok = if dom != "*" && dow != "*" {
        dom_ok || dow_ok
    } else {
        dom_ok && dow_ok
    };
    min_ok && hour_ok && mon_ok && day_ok
}

/// Download one feed episode for a podcast: stream the enclosure into the
/// podcast's folder, write a small metadata sidecar, and mark it downloaded in
/// the catalog. Returns the on-disk audio path. Shared by the manual download
/// command and the scheduler.
pub async fn download_episode<R: Runtime>(
    app: &AppHandle<R>,
    podcast_id: &str,
    episode: &Value,
) -> Result<String, String> {
    let (_feed, folder) = catalog::podcast_feed_and_folder(podcast_id)?;
    let enclosure = episode.get("enclosure");
    let url = enclosure
        .and_then(|e| e.get("url"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "episode has no enclosure URL".to_string())?;
    let mime = enclosure.and_then(|e| e.get("type")).and_then(|v| v.as_str());
    let title = episode.get("title").and_then(|v| v.as_str()).unwrap_or("episode");
    let guid = episode
        .get("guid")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(url)
        .to_string();

    let ext = podcast_feed::enclosure_extension(url, mime);
    let file_name = format!("{}.{ext}", ingest::sanitize_component(title));
    let dest = Path::new(&folder).join(&file_name);
    let dest_str = dest.to_string_lossy().into_owned();

    log::info!(target: "skald::downloads", "episode download podcast={podcast_id} guid={guid} -> path={dest_str}");
    if let Err(e) = podcast_feed::download_enclosure(url, &dest, Some((app, &guid, title))).await {
        log::warn!(target: "skald::downloads", "episode download FAIL guid={guid} err={e}");
        let _ = app.emit("download-failed", serde_json::json!({ "itemId": guid, "title": title, "error": e.clone() }));
        return Err(e);
    }

    // Best-effort metadata sidecar so the on-disk folder is self-describing and a
    // future ABS scan of the same root can recover guid/pubDate/chapters.
    let sidecar = dest.with_extension("json");
    if let Ok(json) = serde_json::to_string_pretty(episode) {
        let _ = std::fs::write(&sidecar, json);
    }

    catalog::set_episode_downloaded(podcast_id, &guid, &dest_str)?;
    Ok(dest_str)
}

/// Run one podcast's auto-download pass: re-fetch the feed, upsert episodes,
/// download up to `max_new` newest undownloaded, prune to `max_keep`.
async fn run_one<R: Runtime>(app: &AppHandle<R>, p: &catalog::PodcastSchedule) {
    let xml = match podcast_feed::fetch_feed_text(&p.feed_url).await {
        Ok(x) => x,
        Err(e) => { log::warn!(target: "skald::library", "auto-download feed fetch FAIL podcast={} err={e}", p.id); return; }
    };
    let feed = match podcast_feed::parse_feed(&xml, &p.feed_url) {
        Ok(f) => f,
        Err(e) => { log::warn!(target: "skald::metadata", "auto-download feed parse FAIL podcast={} err={e}", p.id); return; }
    };
    if let Some(eps) = feed.get("episodes").and_then(|e| e.as_array()) {
        let _ = catalog::upsert_episodes(&p.id, eps);
    }
    let _ = catalog::touch_episode_check(&p.id);

    // Newest undownloaded first, capped at max_new (0 → nothing to fetch).
    let max_new = p.max_new.max(0) as usize;
    if max_new > 0 {
        match catalog::undownloaded_episodes(&p.id, max_new) {
            Ok(eps) => {
                for (ep, _guid) in eps {
                    let _ = download_episode(app, &p.id, &ep).await;
                }
            }
            Err(e) => log::warn!(target: "skald::library", "auto-download list FAIL podcast={} err={e}", p.id),
        }
    }

    // Retention prune (never the currently-playing episode — the scheduler has no
    // playback handle here, so pass None; the manual play path keeps its own row).
    let _ = catalog::prune_episodes(&p.id, p.max_keep, None);
    let _ = app.emit("local-podcast-updated", serde_json::json!({ "podcastId": p.id }));
}

/// Spawn the auto-download scheduler: an initial catch-up for stale podcasts, then
/// a per-minute cron evaluation. Idempotent guarding uses each podcast's
/// `last_episode_check` so a due cron fires at most once per minute.
pub fn start<R: Runtime>(app: AppHandle<R>) {
    // Use Tauri's managed async runtime rather than `tokio::spawn`: `start` is
    // called from the synchronous `setup()` hook, which is NOT inside a Tokio
    // runtime context, so a bare `tokio::spawn` panics ("no reactor running").
    // `async_runtime::spawn` schedules onto Tauri's always-present runtime, and
    // `tokio::time` works inside the task because that runtime is tokio-backed.
    tauri::async_runtime::spawn(async move {
        // ── Launch catch-up ───────────────────────────────────────────────────
        // Fetch podcasts not checked in the last 6 hours so a daily schedule isn't
        // missed across restarts. Skips podcasts already checked recently.
        const SIX_HOURS_MS: i64 = 6 * 60 * 60 * 1000;
        let now_ms = chrono::Utc::now().timestamp_millis();
        if let Ok(podcasts) = catalog::list_auto_download_podcasts() {
            for p in &podcasts {
                if now_ms - p.last_check >= SIX_HOURS_MS {
                    run_one(&app, p).await;
                }
            }
            if !podcasts.is_empty() {
                log::info!(target: "skald::library", "auto-download launch catch-up podcasts={}", podcasts.len());
            }
        }

        // ── Per-minute cron tick ──────────────────────────────────────────────
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            let now = Local::now();
            // Floor to the current minute (ms) so a cron fires at most once per minute.
            let minute_floor = now.timestamp_millis() - (now.timestamp_millis() % 60_000);
            let podcasts = match catalog::list_auto_download_podcasts() {
                Ok(p) => p,
                Err(_) => continue,
            };
            let mut due = 0usize;
            for p in &podcasts {
                let Some(ref schedule) = p.schedule else { continue };
                if cron_matches(schedule, &now) && p.last_check < minute_floor {
                    due += 1;
                    run_one(&app, p).await;
                }
            }
            if due > 0 {
                log::info!(target: "skald::library", "auto-download tick due={due}");
            }
        }
    });
}
