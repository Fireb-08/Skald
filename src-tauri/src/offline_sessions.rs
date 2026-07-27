//! offline_sessions.rs — client-built ABS playback sessions for *downloaded*
//! (offline) listening, so time spent offline reaches the server's listening
//! stats on the days it actually happened.
//!
//! Position/progress is NOT handled here. That stays on the existing
//! `offline_progress.json` → `/api/me/progress` path in `downloads.rs`, which
//! remains authoritative for *where you are in the book*. This module owns the
//! second, independent channel: *how long you listened, and when*.
//!
//! Why not route offline listening through `/play` sessions on reconnect: ABS
//! stamps a live session with the server's clock, so days of offline listening
//! collapse into one session dated "now" and log as Direct Play rather than
//! local. Hence the local-session flow the official mobile apps use —
//! `POST /api/session/local-all` (batch) and `POST /api/session/local`.
//!
//! ## Verified against the ABS source (2026-07-27)
//!
//! `server/managers/PlaybackSessionManager.js` → `syncLocalSession`:
//!
//! - Sessions **upsert by `id`**, and `timeListening` is *assigned*, not added —
//!   so a session must always carry its **cumulative** total.
//! - `userId` is taken from the authenticated user; a body `userId` is ignored.
//! - On **create**, the client's `date`/`dayOfWeek` are honoured verbatim.
//!   On **update**, the server *re-derives* both from `updatedAt`. This is why
//!   the timestamps captured at accrual time are replayed verbatim at flush and
//!   never restamped: restamping is exactly what re-collapses multi-day
//!   listening onto the flush date.
//! - The sync also writes media progress from the session, but only when the
//!   user's existing progress is not newer than `updatedAt`. The flush path
//!   therefore runs *after* the progress queue and skips any item still holding
//!   a queued position — see `commands/offline.rs`.

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// `PlayMethod.LOCAL` in `server/utils/constants.js` — the value that makes ABS
/// file this as offline listening rather than Direct Play.
pub const PLAY_METHOD_LOCAL: u8 = 3;

/// A client-minted playback session covering one calendar day of listening to
/// one downloaded item. Field names mirror `server/objects/PlaybackSession.js`
/// because the whole struct is the request body.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalSession {
    /// Client-minted UUIDv4. ABS upserts on this, so re-sending a session that
    /// was already accepted updates it rather than double-counting it.
    pub id: String,
    pub library_item_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_id: Option<String>,
    pub media_type: String,
    pub display_title: String,
    pub display_author: String,
    /// Server-authoritative on create (ABS overwrites it from the library item);
    /// kept because it is part of the documented body and useful in the log.
    pub duration: f64,
    pub play_method: u8,
    pub media_player: String,
    /// Cumulative seconds for this session — never a delta (see module docs).
    pub time_listening: f64,
    /// Media position when this session was minted.
    pub start_time: f64,
    /// Latest media position; ABS mirrors it into media progress when it is not
    /// older than the user's existing record.
    pub current_time: f64,
    /// Epoch ms captured when the session was minted. Replayed verbatim.
    pub started_at: i64,
    /// Epoch ms of the last accrual. Replayed verbatim — the server re-derives
    /// `date`/`dayOfWeek` from this on the update path.
    pub updated_at: i64,
    /// Local calendar day, `YYYY-MM-DD`.
    pub date: String,
    /// Full English weekday name, matching ABS's `dddd` format.
    pub day_of_week: String,
}

impl LocalSession {
    /// True when this session covers the same listening identity as `ctx` —
    /// a different book (or episode) always gets its own session.
    fn is_for(&self, ctx: &SessionContext) -> bool {
        self.library_item_id == ctx.item_id && self.episode_id == ctx.episode_id
    }
}

/// Identity and display metadata of the item being listened to offline.
/// Built once when local playback starts; the tick only supplies numbers.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionContext {
    pub item_id: String,
    pub episode_id: Option<String>,
    pub media_type: String,
    pub display_title: String,
    pub display_author: String,
}

/// On-disk shape of `local_sessions.json`: the session currently accruing plus
/// the ones waiting to be flushed. Splitting them keeps the flush from ever
/// touching a session that is still growing.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalSessionStore {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<LocalSession>,
    #[serde(default)]
    pub pending: Vec<LocalSession>,
}

const SESSIONS_FILE: &str = "local_sessions.json";
const SESSIONS_TMP: &str = "local_sessions.json.tmp";
const UNSUPPORTED_FILE: &str = "local_sessions_unsupported.json";
const UNSUPPORTED_TMP: &str = "local_sessions_unsupported.json.tmp";

/// Pending sessions older than this are dropped at accrual time. A server that
/// has rejected a session for a month (deleted item, permanently missing
/// library) will not start accepting it, and the store must stay bounded.
const MAX_PENDING_AGE_DAYS: i64 = 30;

/// Below this, a session is not worth reporting — a sub-second slot left by a
/// mis-tap would otherwise land in the server's stats as a real listen.
const MIN_REPORTABLE_SECONDS: f64 = 1.0;

/// Serializes the store's read-modify-write cycles, exactly as `QUEUE_LOCK`
/// does for the progress queue: the playback tick accrues while a flush removes
/// acknowledged sessions, and an interleaved load→save would drop one of them.
static SESSION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

// ── Clock seam ────────────────────────────────────────────────────────────────
// Day-boundary splitting is the one behaviour that cannot be tested without
// controlling the clock, so the clock is injected rather than read globally.

pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Local>;
}

/// The real clock. Local time, because "the day it happened" is the listener's
/// calendar day, not UTC's.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Local> {
        Local::now()
    }
}

fn calendar_day(now: DateTime<Local>) -> String {
    now.format("%Y-%m-%d").to_string()
}

/// ABS formats `dayOfWeek` with date-and-time's `dddd` — the full weekday name
/// ("Monday"). chrono's `%A` is the same and is locale-independent, so the two
/// agree regardless of the machine's locale. Note `Weekday::to_string()` is the
/// *abbreviated* form ("Mon") and would silently disagree with every session the
/// server writes itself.
fn day_of_week(now: DateTime<Local>) -> String {
    now.format("%A").to_string()
}

// ── Persistence ───────────────────────────────────────────────────────────────

/// Load the session store. Missing is the normal first-run state; a corrupt
/// file is preserved as `local_sessions.json.corrupt` and reported to the user,
/// because a silently-emptied store loses listening that was never reported.
pub fn load_store(downloads_dir: &Path) -> LocalSessionStore {
    crate::downloads::load_json_or_preserve(
        &downloads_dir.join(SESSIONS_FILE),
        "offline listening sessions",
        true,
    )
}

/// Persist the store with the same write-then-rename guarantee as the progress
/// queue, so the file is never left half-written.
pub fn save_store(downloads_dir: &Path, store: &LocalSessionStore) -> Result<(), String> {
    let json = serde_json::to_string_pretty(store).map_err(|e| format!("Serialize error: {e}"))?;
    let path = downloads_dir.join(SESSIONS_FILE);
    let tmp = downloads_dir.join(SESSIONS_TMP);
    std::fs::write(&tmp, &json).map_err(|e| format!("Write error: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Rename error: {e}"))?;
    Ok(())
}

// ── Accrual ───────────────────────────────────────────────────────────────────

/// Credit `seconds` of offline listening to `ctx`.
///
/// Mints a session on first call, retires the active one to `pending` when the
/// item changes or the calendar day rolls over, and stamps `updatedAt` from the
/// clock **now** — the timestamp the flush later replays verbatim.
///
/// Local-library items are rejected here as well as gated at the call site:
/// their listening lives in `catalog.db`, and reporting it to ABS would invent
/// server-side listening for an item the server has never heard of.
pub fn accrue(
    downloads_dir: &Path,
    ctx: &SessionContext,
    seconds: f64,
    current_time: f64,
    duration: f64,
    clock: &dyn Clock,
) -> Result<(), String> {
    if ctx.item_id.starts_with("local_") {
        return Ok(());
    }
    if !(seconds.is_finite() && seconds > 0.0) {
        return Ok(());
    }

    let _guard = SESSION_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // The first offline write can precede any download if the user relocated
    // the folder — mirror the progress queue and create it on demand.
    std::fs::create_dir_all(downloads_dir).map_err(|e| format!("Create dir failed: {e}"))?;

    let now = clock.now();
    let today = calendar_day(now);
    let now_ms = now.timestamp_millis();

    let mut store = load_store(downloads_dir);
    prune_expired(&mut store, now_ms);

    // Retire the active session when it no longer covers this listening: a
    // different item, or the same item on a new calendar day. The day case is
    // the whole point of splitting — each day's total has to land on its day.
    if let Some(active) = store.active.take() {
        let same_item = active.is_for(ctx);
        let same_day = active.date == today;
        if same_item && same_day {
            store.active = Some(active);
        } else {
            if !same_day {
                log::info!(target: "skald::sync",
                    "offline listening day split item={} from={} to={}",
                    active.library_item_id, active.date, today);
            }
            retire(&mut store, active);
        }
    }

    let active = store.active.get_or_insert_with(|| {
        log::info!(target: "skald::sync",
            "offline listening session minted item={} date={today}", ctx.item_id);
        LocalSession {
            id: uuid::Uuid::new_v4().to_string(),
            library_item_id: ctx.item_id.clone(),
            episode_id: ctx.episode_id.clone(),
            media_type: ctx.media_type.clone(),
            display_title: ctx.display_title.clone(),
            display_author: ctx.display_author.clone(),
            duration,
            play_method: PLAY_METHOD_LOCAL,
            media_player: "vlc".to_string(),
            time_listening: 0.0,
            start_time: current_time,
            current_time,
            started_at: now_ms,
            updated_at: now_ms,
            date: today.clone(),
            day_of_week: day_of_week(now),
        }
    });

    active.time_listening += seconds;
    active.current_time = current_time;
    // The player reports 0 until the media is open, so a later tick carries the
    // first real duration. Never overwrite a known duration with 0.
    if duration > 0.0 {
        active.duration = duration;
    }
    active.updated_at = now_ms;

    save_store(downloads_dir, &store)
}

/// Move the active session to `pending` so the next flush can send it. Called
/// when local playback stops or switches items — anything still accruing must
/// never be flushed, and anything finished must not wait for the next accrual.
pub fn retire_active(downloads_dir: &Path) -> Result<(), String> {
    let _guard = SESSION_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut store = load_store(downloads_dir);
    let Some(active) = store.active.take() else {
        return Ok(());
    };
    retire(&mut store, active);
    save_store(downloads_dir, &store)
}

/// Park a finished session in `pending`, dropping the ones too short to report.
fn retire(store: &mut LocalSessionStore, session: LocalSession) {
    if session.time_listening < MIN_REPORTABLE_SECONDS {
        return;
    }
    log::debug!(target: "skald::sync",
        "offline listening session retired id={} date={} seconds={}",
        session.id, session.date, session.time_listening);
    store.pending.push(session);
}

/// Drop pending sessions that have aged out (see `MAX_PENDING_AGE_DAYS`).
fn prune_expired(store: &mut LocalSessionStore, now_ms: i64) {
    let cutoff = now_ms - MAX_PENDING_AGE_DAYS * 24 * 60 * 60 * 1_000;
    let before = store.pending.len();
    store.pending.retain(|session| session.updated_at >= cutoff);
    let dropped = before - store.pending.len();
    if dropped > 0 {
        log::warn!(target: "skald::sync",
            "dropped {dropped} offline listening session(s) older than {MAX_PENDING_AGE_DAYS} days");
    }
}

// ── Flush support ─────────────────────────────────────────────────────────────

/// Snapshot of the sessions ready to send. Read-only: nothing leaves the store
/// until the server acknowledges it by id.
pub fn pending_sessions(downloads_dir: &Path) -> Vec<LocalSession> {
    load_store(downloads_dir).pending
}

/// Remove exactly the sessions the server acknowledged, leaving everything else
/// queued. Same swap-file guard as the progress queue: the store is re-read
/// under the lock, so a session minted mid-flush is never dropped. Returns how
/// many rows were actually removed.
pub fn remove_pending(downloads_dir: &Path, acked_ids: &[String]) -> Result<usize, String> {
    if acked_ids.is_empty() {
        return Ok(0);
    }
    let _guard = SESSION_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut store = load_store(downloads_dir);
    let before = store.pending.len();
    store.pending.retain(|session| !acked_ids.contains(&session.id));
    let removed = before - store.pending.len();
    if removed == 0 {
        return Ok(0);
    }
    save_store(downloads_dir, &store)?;
    Ok(removed)
}

/// The `deviceInfo` ABS files these sessions under.
///
/// Only `deviceId`, `clientName`, `clientVersion`, `manufacturer`, `model` and
/// `sdkVersion` are read from the client (`server/objects/DeviceInfo.js` →
/// `setData`); everything else the server derives, and `deviceName` it composes
/// itself as `"{manufacturer} {model}"`. The session list shows
/// `deviceDescription`, which is `"{model} / v{clientVersion}"` **only when a
/// model is present** — with none it falls back to the User-Agent, and reqwest
/// sends no User-Agent, so an ABS admin would see a row of nulls. Hence a model.
/// `clientName` is sent explicitly because ABS otherwise defaults a
/// model-bearing client to "Abs iOS".
pub fn device_info(device_id: &str) -> serde_json::Value {
    serde_json::json!({
        "deviceId": device_id,
        "clientName": "Skald",
        "clientVersion": env!("CARGO_PKG_VERSION"),
        // Reads as "Linux Skald Desktop" / "Windows Skald Desktop" in the UI.
        "manufacturer": os_label(),
        "model": "Skald Desktop",
    })
}

/// Human-facing OS name. `std::env::consts::OS` is lowercase ("linux"), which
/// looks wrong beside ABS's own device rows.
fn os_label() -> &'static str {
    match std::env::consts::OS {
        "windows" => "Windows",
        "linux" => "Linux",
        "macos" => "macOS",
        other => other,
    }
}

// ── Old-server detection ──────────────────────────────────────────────────────

/// Servers known not to implement the local-session routes, keyed by server URL
/// so a user with both an old and a current server keeps the flow on the latter.
type UnsupportedServers = std::collections::HashMap<String, bool>;

fn server_key(server_url: &str) -> String {
    server_url.trim().trim_end_matches('/').to_lowercase()
}

/// True when this server previously answered 404/501 to the local-session
/// routes. Position sync is unaffected — the progress queue already covers it.
pub fn is_unsupported(downloads_dir: &Path, server_url: &str) -> bool {
    let servers: UnsupportedServers = crate::downloads::load_json_or_preserve(
        &downloads_dir.join(UNSUPPORTED_FILE),
        "local-session support flags",
        false,
    );
    servers.get(&server_key(server_url)).copied().unwrap_or(false)
}

/// Record that this server does not support local sessions, so later flushes
/// skip the route entirely instead of retrying it on every reconnect.
pub fn mark_unsupported(downloads_dir: &Path, server_url: &str) -> Result<(), String> {
    let _guard = SESSION_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = downloads_dir.join(UNSUPPORTED_FILE);
    let mut servers: UnsupportedServers =
        crate::downloads::load_json_or_preserve(&path, "local-session support flags", false);
    servers.insert(server_key(server_url), true);
    let json = serde_json::to_string_pretty(&servers).map_err(|e| format!("Serialize error: {e}"))?;
    let tmp = downloads_dir.join(UNSUPPORTED_TMP);
    std::fs::write(&tmp, &json).map_err(|e| format!("Write error: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Rename error: {e}"))?;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────
// Everything runs against a tempfile dir — never the user's real downloads
// folder (Testing Suite plan).
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    /// Test clock. `advance` is what lets a test cross midnight in one step.
    struct FixedClock(std::sync::Mutex<DateTime<Local>>);

    impl FixedClock {
        fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> Self {
            Self(std::sync::Mutex::new(
                Local.with_ymd_and_hms(y, m, d, h, min, 0).single().expect("unambiguous test time"),
            ))
        }
        fn advance(&self, minutes: i64) {
            let mut now = self.0.lock().unwrap();
            *now += chrono::Duration::minutes(minutes);
        }
    }

    impl Clock for FixedClock {
        fn now(&self) -> DateTime<Local> {
            *self.0.lock().unwrap()
        }
    }

    fn ctx(item_id: &str) -> SessionContext {
        SessionContext {
            item_id: item_id.to_string(),
            episode_id: None,
            media_type: "book".to_string(),
            display_title: "The Red Knight".to_string(),
            display_author: "Miles Cameron".to_string(),
        }
    }

    #[test]
    fn accrual_accumulates_time_listening() {
        let dir = tempfile::tempdir().unwrap();
        let clock = FixedClock::at(2026, 7, 27, 10, 0);
        let book = ctx("li_abc");

        accrue(dir.path(), &book, 30.0, 130.0, 3600.0, &clock).unwrap();
        clock.advance(1);
        accrue(dir.path(), &book, 30.0, 160.0, 3600.0, &clock).unwrap();

        let store = load_store(dir.path());
        let active = store.active.expect("session still accruing");
        assert_eq!(active.time_listening, 60.0, "ticks sum into one session");
        assert_eq!(active.current_time, 160.0, "latest position wins");
        assert_eq!(active.start_time, 130.0, "start position is the first tick's, not the latest");
        assert_eq!(active.play_method, PLAY_METHOD_LOCAL);
        assert!(store.pending.is_empty(), "an accruing session is never flushable");

        // A pause credits no seconds, so it must not extend the session at all.
        let before = load_store(dir.path());
        accrue(dir.path(), &book, 0.0, 160.0, 3600.0, &clock).unwrap();
        assert_eq!(load_store(dir.path()), before, "a zero-second tick changes nothing");
    }

    #[test]
    fn day_boundary_mints_new_session() {
        let dir = tempfile::tempdir().unwrap();
        let clock = FixedClock::at(2026, 7, 27, 23, 50);
        let book = ctx("li_abc");

        accrue(dir.path(), &book, 600.0, 600.0, 3600.0, &clock).unwrap();
        let first_id = load_store(dir.path()).active.unwrap().id;

        clock.advance(20); // 00:10 the next day
        accrue(dir.path(), &book, 600.0, 1200.0, 3600.0, &clock).unwrap();

        let store = load_store(dir.path());
        assert_eq!(store.pending.len(), 1, "the finished day is retired for flushing");
        let yesterday = &store.pending[0];
        assert_eq!(yesterday.id, first_id);
        assert_eq!(yesterday.date, "2026-07-27");
        assert_eq!(yesterday.day_of_week, "Monday");
        assert_eq!(yesterday.time_listening, 600.0);

        let today = store.active.expect("a fresh session covers the new day");
        assert_ne!(today.id, first_id, "a new day gets a new session id");
        assert_eq!(today.date, "2026-07-28");
        assert_eq!(today.day_of_week, "Tuesday");
        assert_eq!(today.time_listening, 600.0, "the new day starts its own total");
        assert_eq!(today.start_time, 1200.0);
    }

    #[test]
    fn retire_on_stop_and_item_change() {
        let dir = tempfile::tempdir().unwrap();
        let clock = FixedClock::at(2026, 7, 27, 9, 0);

        accrue(dir.path(), &ctx("li_one"), 60.0, 60.0, 3600.0, &clock).unwrap();
        // Switching books retires the first session without waiting for a stop.
        accrue(dir.path(), &ctx("li_two"), 60.0, 60.0, 1800.0, &clock).unwrap();

        let store = load_store(dir.path());
        assert_eq!(store.pending.len(), 1);
        assert_eq!(store.pending[0].library_item_id, "li_one");
        assert_eq!(store.active.as_ref().unwrap().library_item_id, "li_two");

        retire_active(dir.path()).unwrap();
        let store = load_store(dir.path());
        assert!(store.active.is_none(), "no orphaned active slot after a stop");
        assert_eq!(store.pending.len(), 2);

        // Idempotent: a second stop (shutdown racing the tick's loop-end drain)
        // must not duplicate the session.
        retire_active(dir.path()).unwrap();
        assert_eq!(load_store(dir.path()).pending.len(), 2);
    }

    #[test]
    fn sub_second_sessions_are_not_reported() {
        let dir = tempfile::tempdir().unwrap();
        let clock = FixedClock::at(2026, 7, 27, 9, 0);

        accrue(dir.path(), &ctx("li_one"), 0.4, 0.4, 3600.0, &clock).unwrap();
        retire_active(dir.path()).unwrap();

        assert!(load_store(dir.path()).pending.is_empty(), "noise never reaches the server");
    }

    #[test]
    fn persistence_roundtrip_and_corrupt_preservation() {
        let dir = tempfile::tempdir().unwrap();
        let clock = FixedClock::at(2026, 7, 27, 9, 0);
        accrue(dir.path(), &ctx("li_abc"), 45.0, 45.0, 3600.0, &clock).unwrap();
        retire_active(dir.path()).unwrap();

        let saved = load_store(dir.path());
        assert_eq!(saved.pending.len(), 1);
        // Round-trip through the real file, then through serde again, so a
        // rename of any camelCase key fails here rather than at the server.
        let raw = std::fs::read_to_string(dir.path().join(SESSIONS_FILE)).unwrap();
        assert!(raw.contains("\"libraryItemId\""), "body keys stay camelCase");
        assert!(raw.contains("\"dayOfWeek\""));
        assert!(raw.contains("\"timeListening\""));
        let reparsed: LocalSessionStore = serde_json::from_str(&raw).unwrap();
        assert_eq!(reparsed, saved);

        // Corrupt file → quarantined, empty start, user notified.
        std::fs::write(dir.path().join(SESSIONS_FILE), b"{ not json").unwrap();
        let recovered = load_store(dir.path());
        assert_eq!(recovered, LocalSessionStore::default());
        assert!(dir.path().join("local_sessions.json.corrupt").exists(), "evidence survives");
        assert!(
            crate::downloads::take_corrupt_notices()
                .iter()
                .any(|n| n.contains("offline listening sessions")),
            "the reset is surfaced, not silent",
        );
    }

    /// The anti-restamp invariant, and the single most important behaviour in
    /// this module. A session's timestamps are captured when the listening
    /// happens and must reach the wire untouched no matter how much later the
    /// flush runs — restamping is exactly what collapses days of offline
    /// listening onto the reconnect date. It matters twice over because ABS
    /// re-derives `date`/`dayOfWeek` from `updatedAt` whenever it updates an
    /// existing session.
    #[test]
    fn flush_serializes_verbatim_timestamps() {
        let dir = tempfile::tempdir().unwrap();
        let clock = FixedClock::at(2026, 7, 20, 21, 30);
        accrue(dir.path(), &ctx("li_abc"), 1_800.0, 1_800.0, 7_200.0, &clock).unwrap();
        retire_active(dir.path()).unwrap();
        let accrued = pending_sessions(dir.path()).remove(0);

        // A week passes before the device is online again.
        clock.advance(7 * 24 * 60);
        accrue(dir.path(), &ctx("li_other"), 60.0, 60.0, 3600.0, &clock).unwrap();

        let body = serde_json::to_value(&pending_sessions(dir.path())[0]).unwrap();
        assert_eq!(body["startedAt"], accrued.started_at, "minted-at survives the wait");
        assert_eq!(body["updatedAt"], accrued.updated_at, "last-accrual survives the wait");
        assert_eq!(body["date"], "2026-07-20", "the listening keeps its own day");
        assert_eq!(body["dayOfWeek"], "Monday");
        assert_eq!(body["timeListening"], 1_800.0, "cumulative, as ABS assigns it directly");
        assert_eq!(body["playMethod"], 3);
    }

    #[test]
    fn abs_items_only() {
        let dir = tempfile::tempdir().unwrap();
        let clock = FixedClock::at(2026, 7, 27, 9, 0);

        // Local-library playback keeps its listening in catalog.db. Even if the
        // call-site gate regressed, no local session may be minted for it.
        accrue(dir.path(), &ctx("local_book_17"), 300.0, 300.0, 3600.0, &clock).unwrap();

        assert_eq!(load_store(dir.path()), LocalSessionStore::default());
    }

    #[test]
    fn remove_pending_removes_only_acked_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let clock = FixedClock::at(2026, 7, 27, 9, 0);
        accrue(dir.path(), &ctx("li_one"), 60.0, 60.0, 3600.0, &clock).unwrap();
        accrue(dir.path(), &ctx("li_two"), 60.0, 60.0, 3600.0, &clock).unwrap();
        retire_active(dir.path()).unwrap();

        let pending = pending_sessions(dir.path());
        assert_eq!(pending.len(), 2);
        let removed = remove_pending(dir.path(), &[pending[0].id.clone()]).unwrap();

        assert_eq!(removed, 1);
        let left = pending_sessions(dir.path());
        assert_eq!(left.len(), 1, "an unacknowledged session stays queued");
        assert_eq!(left[0].id, pending[1].id);
    }

    #[test]
    fn expired_sessions_are_dropped_so_the_store_stays_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let clock = FixedClock::at(2026, 7, 27, 9, 0);
        accrue(dir.path(), &ctx("li_old"), 60.0, 60.0, 3600.0, &clock).unwrap();
        retire_active(dir.path()).unwrap();
        assert_eq!(pending_sessions(dir.path()).len(), 1);

        // A server that has refused this session for a month never will accept it.
        clock.advance((MAX_PENDING_AGE_DAYS + 1) * 24 * 60);
        accrue(dir.path(), &ctx("li_new"), 60.0, 60.0, 3600.0, &clock).unwrap();

        let store = load_store(dir.path());
        assert!(store.pending.is_empty(), "the aged-out session is gone");
        assert_eq!(store.active.unwrap().library_item_id, "li_new");
    }

    #[test]
    fn unsupported_flag_is_per_server_and_survives_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_unsupported(dir.path(), "https://abs.example.com"));

        mark_unsupported(dir.path(), "https://abs.example.com/").unwrap();

        // Trailing slash and case are the same server; a different host is not.
        assert!(is_unsupported(dir.path(), "https://ABS.example.com"));
        assert!(!is_unsupported(dir.path(), "https://other.example.com"));
    }
}
