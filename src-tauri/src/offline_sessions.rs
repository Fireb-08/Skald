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
//!
//! ## Two consequences of "the authenticated user wins"
//!
//! Because ABS credits the *authenticated* user and ignores the body's `userId`,
//! a session queued by one account and flushed by another is silently filed
//! under the wrong person. The store therefore records which (server, user) each
//! session was accrued under, and the flush sends only its own — a session
//! belonging to another login simply waits for that login (see `StoredSession`).
//!
//! For the same reason the *instant* a session is credited to is supplied by the
//! caller rather than read from the clock here: seconds are counted in buckets,
//! and a bucket drained at 00:00:05 may hold listening that happened yesterday.

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

/// A session as it is *stored*: the wire body plus the account it was accrued
/// under. The binding never reaches the server — only `session` is serialized
/// into a request — it exists so a flush can tell its own listening from
/// another login's (see the module docs).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredSession {
    #[serde(flatten)]
    pub session: LocalSession,
    /// Normalized server URL, as `server_key` produces it.
    #[serde(default)]
    pub server_key: String,
    /// The ABS user id that was authenticated when the listening happened.
    #[serde(default)]
    pub user_id: String,
}

impl StoredSession {
    /// True when this session covers the same listening as `ctx`: the same
    /// account, the same book (or episode). Any difference means a new session —
    /// which is exactly what keeps one listener's time out of another's stats.
    fn is_for(&self, ctx: &SessionContext) -> bool {
        self.session.library_item_id == ctx.item_id
            && self.session.episode_id == ctx.episode_id
            && self.belongs_to(&ctx.server_key, &ctx.user_id)
    }

    /// True when this session was accrued under the given login. An unbound
    /// session (written before the binding existed) belongs to nobody and is
    /// deliberately never claimed — guessing is what misattributes listening.
    fn belongs_to(&self, server_key: &str, user_id: &str) -> bool {
        !self.user_id.is_empty() && self.server_key == server_key && self.user_id == user_id
    }
}

/// Identity and display metadata of the item being listened to offline, plus
/// the account doing the listening. Built once when local playback starts; the
/// tick only supplies numbers.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionContext {
    pub item_id: String,
    pub episode_id: Option<String>,
    pub media_type: String,
    pub display_title: String,
    pub display_author: String,
    /// Normalized server URL this item came from (`server_key`).
    pub server_key: String,
    /// ABS user id listening to it. Captured at playback start because the
    /// flush can happen days later, under a different login or none at all.
    pub user_id: String,
}

/// On-disk shape of `local_sessions.json`: the session currently accruing plus
/// the ones waiting to be flushed. Splitting them keeps the flush from ever
/// touching a session that is still growing.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalSessionStore {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<StoredSession>,
    #[serde(default)]
    pub pending: Vec<StoredSession>,
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

// ── Time ──────────────────────────────────────────────────────────────────────
// Callers pass the instant listening is credited to rather than this module
// reading a clock: seconds arrive in buckets, and the instant a bucket is
// *drained* is not the instant it was *listened*. Local time throughout, because
// "the day it happened" is the listener's calendar day, not UTC's.

fn calendar_day(now: DateTime<Local>) -> String {
    now.format("%Y-%m-%d").to_string()
}

/// Convert an epoch-ms stamp taken by the tick loop into a local instant.
/// Falls back to now for a value no clock could have produced.
pub fn local_instant(epoch_ms: i64) -> DateTime<Local> {
    DateTime::from_timestamp_millis(epoch_ms)
        .map(|utc| utc.with_timezone(&Local))
        .unwrap_or_else(Local::now)
}

/// True when two epoch-ms stamps fall on different local calendar days — the
/// tick loop's signal to drain a bucket before it straddles midnight.
pub fn day_changed(earlier_ms: i64, later_ms: i64) -> bool {
    calendar_day(local_instant(earlier_ms)) != calendar_day(local_instant(later_ms))
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

/// Credit `seconds` of offline listening to `ctx`, as listened **at `at`**.
///
/// Mints a session on first call, retires the active one to `pending` when the
/// account, the item, or the calendar day changes, and stamps `updatedAt` from
/// `at` — the timestamp the flush later replays verbatim.
///
/// `at` is when the listening happened, which is not when this is called: the
/// tick loop counts seconds into a bucket and drains it later. Passing the
/// drain time instead would file the last seconds of an evening on the next day
/// (and, after a suspend, on a completely unrelated one).
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
    at: DateTime<Local>,
) -> Result<(), String> {
    if ctx.item_id.starts_with("local_") {
        return Ok(());
    }
    if !(seconds.is_finite() && seconds > 0.0) {
        return Ok(());
    }
    if ctx.user_id.is_empty() {
        // Keep the listening — it is real — but say so once: an unbound session
        // cannot be attributed to anyone and will age out unflushed.
        log::warn!(target: "skald::sync",
            "offline listening accrued with no user identity item={} — it cannot be flushed", ctx.item_id);
    }

    let _guard = SESSION_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // The first offline write can precede any download if the user relocated
    // the folder — mirror the progress queue and create it on demand.
    std::fs::create_dir_all(downloads_dir).map_err(|e| format!("Create dir failed: {e}"))?;

    let today = calendar_day(at);
    let at_ms = at.timestamp_millis();

    let mut store = load_store(downloads_dir);
    prune_expired(&mut store, at_ms);

    // Retire the active session when it no longer covers this listening: a
    // different account or item, or the same item on a new calendar day. The day
    // case is the whole point of splitting — each day's total lands on its day.
    if let Some(active) = store.active.take() {
        let same_listening = active.is_for(ctx);
        let same_day = active.session.date == today;
        if same_listening && same_day {
            store.active = Some(active);
        } else {
            if same_listening && !same_day {
                log::info!(target: "skald::sync",
                    "offline listening day split item={} from={} to={}",
                    active.session.library_item_id, active.session.date, today);
            }
            retire(&mut store, active);
        }
    }

    let active = store.active.get_or_insert_with(|| {
        log::info!(target: "skald::sync",
            "offline listening session minted item={} date={today}", ctx.item_id);
        StoredSession {
            session: LocalSession {
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
                started_at: at_ms,
                updated_at: at_ms,
                date: today.clone(),
                day_of_week: day_of_week(at),
            },
            server_key: ctx.server_key.clone(),
            user_id: ctx.user_id.clone(),
        }
    });

    active.session.time_listening += seconds;
    active.session.current_time = current_time;
    // The player reports 0 until the media is open, so a later tick carries the
    // first real duration. Never overwrite a known duration with 0.
    if duration > 0.0 {
        active.session.duration = duration;
    }
    active.session.updated_at = at_ms;

    save_store(downloads_dir, &store)
}

/// Move the active session to `pending` unconditionally. Only for a moment when
/// nothing can be playing — app startup, where an active session can only be the
/// remains of a crash. Everything else must use `retire_active_for`.
pub fn retire_active(downloads_dir: &Path) -> Result<(), String> {
    let _guard = SESSION_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut store = load_store(downloads_dir);
    let Some(active) = store.active.take() else {
        return Ok(());
    };
    retire(&mut store, active);
    save_store(downloads_dir, &store)
}

/// Move the active session to `pending` **only if it is the one `ctx` was
/// playing**. Called when local playback stops or switches items: anything still
/// accruing must never be flushed, and anything finished must not wait for the
/// next accrual.
///
/// The identity check is what makes a late caller harmless. A playback tick task
/// is asked to stop asynchronously, so the previous item's task can wake after
/// the next item has already minted its session; retiring blindly would push a
/// session that is *still growing* into `pending`, where the next reconnect
/// would send it mid-listen and the rest of that same listen would land in a
/// second session.
pub fn retire_active_for(downloads_dir: &Path, ctx: &SessionContext) -> Result<(), String> {
    let _guard = SESSION_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut store = load_store(downloads_dir);
    let Some(active) = store.active.take() else {
        return Ok(());
    };
    if !active.is_for(ctx) {
        // Someone else's session is accruing — put it back untouched.
        log::debug!(target: "skald::sync",
            "skipped retiring the active offline session: item={} is not the caller's ({})",
            active.session.library_item_id, ctx.item_id);
        store.active = Some(active);
        return Ok(());
    }
    retire(&mut store, active);
    save_store(downloads_dir, &store)
}

/// Park a finished session in `pending`, dropping the ones too short to report.
fn retire(store: &mut LocalSessionStore, stored: StoredSession) {
    if stored.session.time_listening < MIN_REPORTABLE_SECONDS {
        return;
    }
    log::debug!(target: "skald::sync",
        "offline listening session retired id={} date={} seconds={}",
        stored.session.id, stored.session.date, stored.session.time_listening);
    store.pending.push(stored);
}

/// Drop pending sessions that have aged out (see `MAX_PENDING_AGE_DAYS`).
fn prune_expired(store: &mut LocalSessionStore, now_ms: i64) {
    let cutoff = now_ms - MAX_PENDING_AGE_DAYS * 24 * 60 * 60 * 1_000;
    let before = store.pending.len();
    store.pending.retain(|stored| stored.session.updated_at >= cutoff);
    let dropped = before - store.pending.len();
    if dropped > 0 {
        log::warn!(target: "skald::sync",
            "dropped {dropped} offline listening session(s) older than {MAX_PENDING_AGE_DAYS} days");
    }
}

// ── Flush support ─────────────────────────────────────────────────────────────

/// Whether anything is queued at all, for any account — the cheap check that
/// keeps an idle reconnect from spending a request on identity resolution.
pub fn has_pending(downloads_dir: &Path) -> bool {
    !load_store(downloads_dir).pending.is_empty()
}

/// Snapshot of the sessions ready to send **for this login**. Read-only:
/// nothing leaves the store until the server acknowledges it by id.
///
/// Sessions belonging to another account stay queued rather than being sent —
/// ABS credits the authenticated user, so flushing them here would file one
/// person's listening under another's name. They flush when that user is back;
/// the age cap keeps a login that never returns from growing the store forever.
pub fn pending_sessions_for(
    downloads_dir: &Path,
    server_url: &str,
    user_id: &str,
) -> Vec<LocalSession> {
    let key = server_key(server_url);
    let (mine, theirs): (Vec<_>, Vec<_>) = load_store(downloads_dir)
        .pending
        .into_iter()
        .partition(|stored| stored.belongs_to(&key, user_id));
    if !theirs.is_empty() {
        log::info!(target: "skald::sync",
            "holding {} offline listening session(s) queued under a different account", theirs.len());
    }
    mine.into_iter().map(|stored| stored.session).collect()
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
    store.pending.retain(|stored| !acked_ids.contains(&stored.session.id));
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

/// Normalized server identity. Shared by the unsupported-server flags and by the
/// per-account session binding, so "the same server" means the same thing to
/// both regardless of a trailing slash or capitalisation.
pub fn server_key(server_url: &str) -> String {
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

    const SERVER: &str = "https://abs.example.com";
    const USER: &str = "usr_listener";

    /// A fixed local instant. Listening is credited *at* an instant the caller
    /// supplies, so a test simply names the moment rather than steering a clock.
    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(y, m, d, h, min, 0).single().expect("unambiguous test time")
    }

    fn ctx(item_id: &str) -> SessionContext {
        ctx_for(item_id, SERVER, USER)
    }

    fn ctx_for(item_id: &str, server_url: &str, user_id: &str) -> SessionContext {
        SessionContext {
            item_id: item_id.to_string(),
            episode_id: None,
            media_type: "book".to_string(),
            display_title: "The Red Knight".to_string(),
            display_author: "Miles Cameron".to_string(),
            server_key: server_key(server_url),
            user_id: user_id.to_string(),
        }
    }

    /// Everything this module's own tests queue belongs to one login.
    fn mine(dir: &Path) -> Vec<LocalSession> {
        pending_sessions_for(dir, SERVER, USER)
    }

    #[test]
    fn accrual_accumulates_time_listening() {
        let dir = tempfile::tempdir().unwrap();
        let ten_am = at(2026, 7, 27, 10, 0);
        let book = ctx("li_abc");

        accrue(dir.path(), &book, 30.0, 130.0, 3600.0, ten_am).unwrap();
        accrue(dir.path(), &book, 30.0, 160.0, 3600.0, ten_am + chrono::Duration::minutes(1)).unwrap();

        let store = load_store(dir.path());
        let active = store.active.expect("session still accruing").session;
        assert_eq!(active.time_listening, 60.0, "ticks sum into one session");
        assert_eq!(active.current_time, 160.0, "latest position wins");
        assert_eq!(active.start_time, 130.0, "start position is the first tick's, not the latest");
        assert_eq!(active.play_method, PLAY_METHOD_LOCAL);
        assert!(store.pending.is_empty(), "an accruing session is never flushable");

        // A pause credits no seconds, so it must not extend the session at all.
        let before = load_store(dir.path());
        accrue(dir.path(), &book, 0.0, 160.0, 3600.0, ten_am + chrono::Duration::minutes(2)).unwrap();
        assert_eq!(load_store(dir.path()), before, "a zero-second tick changes nothing");
    }

    #[test]
    fn day_boundary_mints_new_session() {
        let dir = tempfile::tempdir().unwrap();
        let late = at(2026, 7, 27, 23, 50);
        let book = ctx("li_abc");

        accrue(dir.path(), &book, 600.0, 600.0, 3600.0, late).unwrap();
        let first_id = load_store(dir.path()).active.unwrap().session.id;

        // 00:10 the next day.
        accrue(dir.path(), &book, 600.0, 1200.0, 3600.0, late + chrono::Duration::minutes(20)).unwrap();

        let store = load_store(dir.path());
        assert_eq!(store.pending.len(), 1, "the finished day is retired for flushing");
        let yesterday = &store.pending[0].session;
        assert_eq!(yesterday.id, first_id);
        assert_eq!(yesterday.date, "2026-07-27");
        assert_eq!(yesterday.day_of_week, "Monday");
        assert_eq!(yesterday.time_listening, 600.0);

        let today = store.active.expect("a fresh session covers the new day").session;
        assert_ne!(today.id, first_id, "a new day gets a new session id");
        assert_eq!(today.date, "2026-07-28");
        assert_eq!(today.day_of_week, "Tuesday");
        assert_eq!(today.time_listening, 600.0, "the new day starts its own total");
        assert_eq!(today.start_time, 1200.0);
    }

    #[test]
    fn retire_on_stop_and_item_change() {
        let dir = tempfile::tempdir().unwrap();
        let nine_am = at(2026, 7, 27, 9, 0);

        accrue(dir.path(), &ctx("li_one"), 60.0, 60.0, 3600.0, nine_am).unwrap();
        // Switching books retires the first session without waiting for a stop.
        accrue(dir.path(), &ctx("li_two"), 60.0, 60.0, 1800.0, nine_am).unwrap();

        let store = load_store(dir.path());
        assert_eq!(store.pending.len(), 1);
        assert_eq!(store.pending[0].session.library_item_id, "li_one");
        assert_eq!(store.active.as_ref().unwrap().session.library_item_id, "li_two");

        retire_active_for(dir.path(), &ctx("li_two")).unwrap();
        let store = load_store(dir.path());
        assert!(store.active.is_none(), "no orphaned active slot after a stop");
        assert_eq!(store.pending.len(), 2);

        // Idempotent: a second stop (shutdown racing the tick's loop-end drain)
        // must not duplicate the session.
        retire_active_for(dir.path(), &ctx("li_two")).unwrap();
        assert_eq!(load_store(dir.path()).pending.len(), 2);
    }

    #[test]
    fn sub_second_sessions_are_not_reported() {
        let dir = tempfile::tempdir().unwrap();
        let nine_am = at(2026, 7, 27, 9, 0);

        accrue(dir.path(), &ctx("li_one"), 0.4, 0.4, 3600.0, nine_am).unwrap();
        retire_active_for(dir.path(), &ctx("li_one")).unwrap();

        assert!(load_store(dir.path()).pending.is_empty(), "noise never reaches the server");
    }

    #[test]
    fn persistence_roundtrip_and_corrupt_preservation() {
        let dir = tempfile::tempdir().unwrap();
        let nine_am = at(2026, 7, 27, 9, 0);
        accrue(dir.path(), &ctx("li_abc"), 45.0, 45.0, 3600.0, nine_am).unwrap();
        retire_active_for(dir.path(), &ctx("li_abc")).unwrap();

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
        let evening = at(2026, 7, 20, 21, 30);
        accrue(dir.path(), &ctx("li_abc"), 1_800.0, 1_800.0, 7_200.0, evening).unwrap();
        retire_active_for(dir.path(), &ctx("li_abc")).unwrap();
        let accrued = mine(dir.path()).remove(0);

        // A week passes before the device is online again.
        accrue(dir.path(), &ctx("li_other"), 60.0, 60.0, 3600.0, evening + chrono::Duration::days(7)).unwrap();

        let body = serde_json::to_value(&mine(dir.path())[0]).unwrap();
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
        let nine_am = at(2026, 7, 27, 9, 0);

        // Local-library playback keeps its listening in catalog.db. Even if the
        // call-site gate regressed, no local session may be minted for it.
        accrue(dir.path(), &ctx("local_book_17"), 300.0, 300.0, 3600.0, nine_am).unwrap();

        assert_eq!(load_store(dir.path()), LocalSessionStore::default());
    }

    #[test]
    fn remove_pending_removes_only_acked_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let nine_am = at(2026, 7, 27, 9, 0);
        accrue(dir.path(), &ctx("li_one"), 60.0, 60.0, 3600.0, nine_am).unwrap();
        accrue(dir.path(), &ctx("li_two"), 60.0, 60.0, 3600.0, nine_am).unwrap();
        retire_active_for(dir.path(), &ctx("li_two")).unwrap();

        let pending = mine(dir.path());
        assert_eq!(pending.len(), 2);
        let removed = remove_pending(dir.path(), &[pending[0].id.clone()]).unwrap();

        assert_eq!(removed, 1);
        let left = mine(dir.path());
        assert_eq!(left.len(), 1, "an unacknowledged session stays queued");
        assert_eq!(left[0].id, pending[1].id);
    }

    #[test]
    fn expired_sessions_are_dropped_so_the_store_stays_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let nine_am = at(2026, 7, 27, 9, 0);
        accrue(dir.path(), &ctx("li_old"), 60.0, 60.0, 3600.0, nine_am).unwrap();
        retire_active_for(dir.path(), &ctx("li_old")).unwrap();
        assert_eq!(mine(dir.path()).len(), 1);

        // A server that has refused this session for a month never will accept it.
        let much_later = nine_am + chrono::Duration::days(MAX_PENDING_AGE_DAYS + 1);
        accrue(dir.path(), &ctx("li_new"), 60.0, 60.0, 3600.0, much_later).unwrap();

        let store = load_store(dir.path());
        assert!(store.pending.is_empty(), "the aged-out session is gone");
        assert_eq!(store.active.unwrap().session.library_item_id, "li_new");
    }

    /// ABS credits the *authenticated* user, ignoring the body's `userId`. So a
    /// session queued by one login and flushed by another is filed under the
    /// wrong person — the failure this binding exists to prevent. Covers both
    /// halves of the review's scenario: a different user on the same server, and
    /// the same user id on a different server.
    #[test]
    fn sessions_are_only_ever_offered_to_the_account_that_earned_them() {
        let dir = tempfile::tempdir().unwrap();
        let nine_am = at(2026, 7, 27, 9, 0);

        accrue(dir.path(), &ctx("li_abc"), 600.0, 600.0, 3600.0, nine_am).unwrap();
        retire_active_for(dir.path(), &ctx("li_abc")).unwrap();

        // Logged out, someone else logs in on the same machine and reconnects.
        assert!(
            pending_sessions_for(dir.path(), SERVER, "usr_someone_else").is_empty(),
            "another user's reconnect must not carry off this listening",
        );
        // Same user id, different server — ids are only unique within a server.
        assert!(
            pending_sessions_for(dir.path(), "https://other.example.com", USER).is_empty(),
            "a different server is a different account",
        );
        // The rightful owner still gets it, trailing slash and case regardless.
        let mine = pending_sessions_for(dir.path(), "https://ABS.example.com/", USER);
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].time_listening, 600.0);
    }

    /// A second account listening on the same machine gets its own session
    /// rather than adding its time to whatever was accruing.
    #[test]
    fn a_different_account_never_extends_the_previous_ones_session() {
        let dir = tempfile::tempdir().unwrap();
        let nine_am = at(2026, 7, 27, 9, 0);
        let theirs = ctx_for("li_abc", SERVER, "usr_other");

        accrue(dir.path(), &ctx("li_abc"), 60.0, 60.0, 3600.0, nine_am).unwrap();
        accrue(dir.path(), &theirs, 60.0, 60.0, 3600.0, nine_am).unwrap();

        let store = load_store(dir.path());
        assert_eq!(store.active.as_ref().unwrap().user_id, "usr_other");
        assert_eq!(store.active.as_ref().unwrap().session.time_listening, 60.0, "not 120");
        assert_eq!(store.pending.len(), 1, "the first account's session was closed off");
        assert_eq!(store.pending[0].user_id, USER);
    }

    /// The interleaving from the review, deterministically: a playback tick task
    /// is stopped asynchronously, so the *previous* item's task can reach its
    /// retire after the next item has already minted a session. Retiring the
    /// store's active slot blindly would push a session that is still growing
    /// into `pending`, where a reconnect would send it mid-listen — and the rest
    /// of that same listen would then land in a second session.
    #[test]
    fn a_late_task_from_the_previous_item_cannot_retire_the_live_session() {
        let dir = tempfile::tempdir().unwrap();
        let nine_am = at(2026, 7, 27, 9, 0);
        let first = ctx("li_first");
        let second = ctx("li_second");

        // 1. The first book plays, then the switch drains and closes its session.
        accrue(dir.path(), &first, 60.0, 60.0, 3600.0, nine_am).unwrap();
        retire_active_for(dir.path(), &first).unwrap();
        // 2. The second book starts accruing.
        accrue(dir.path(), &second, 30.0, 30.0, 1800.0, nine_am).unwrap();

        // 3. The first book's tick task finally wakes and retires *its* session.
        retire_active_for(dir.path(), &first).unwrap();

        let store = load_store(dir.path());
        let active = store.active.expect("the playing book's session is untouched");
        assert_eq!(active.session.library_item_id, "li_second");
        assert_eq!(store.pending.len(), 1, "only the finished book is flushable");
        assert_eq!(store.pending[0].session.library_item_id, "li_first");

        // 4. The second book keeps accruing into the same session — one continuous
        //    listen stays one session rather than fragmenting.
        accrue(dir.path(), &second, 30.0, 60.0, 1800.0, nine_am).unwrap();
        let store = load_store(dir.path());
        assert_eq!(store.active.unwrap().session.time_listening, 60.0);
        assert_eq!(store.pending.len(), 1);
    }

    /// Listening is credited to the instant it *happened*, not the instant the
    /// buffered bucket is drained. The tick counts seconds in buckets, so a
    /// bucket that spans local midnight is drained a few seconds into the new
    /// day; dating it from the drain would file the whole bucket — and, after a
    /// suspend, an entire evening — on the wrong day.
    #[test]
    fn a_bucket_drained_after_midnight_is_credited_to_the_day_it_was_listened() {
        let dir = tempfile::tempdir().unwrap();
        let book = ctx("li_abc");

        // The evening's listening, drained when the tick notices the day roll.
        accrue(dir.path(), &book, 1_200.0, 1_200.0, 3600.0, at(2026, 7, 27, 23, 59)).unwrap();
        // The first bucket of the new day.
        accrue(dir.path(), &book, 30.0, 1_230.0, 3600.0, at(2026, 7, 28, 0, 0)).unwrap();

        let store = load_store(dir.path());
        let yesterday = &store.pending[0].session;
        assert_eq!(yesterday.date, "2026-07-27", "the evening stays on its own day");
        assert_eq!(yesterday.day_of_week, "Monday");
        assert_eq!(yesterday.time_listening, 1_200.0);
        let today = store.active.unwrap().session;
        assert_eq!(today.date, "2026-07-28");
        assert_eq!(today.time_listening, 30.0, "only the new day's bucket");
        // The server re-derives date/dayOfWeek from updatedAt when it updates an
        // existing session, so the two must agree or the split is undone on send.
        assert_eq!(
            calendar_day(local_instant(yesterday.updated_at)),
            yesterday.date,
            "updatedAt and date tell the same story",
        );
    }

    /// The signal the tick loop drains on. Getting this wrong in either
    /// direction either splits every bucket or none of them.
    #[test]
    fn day_changed_tracks_the_local_calendar_not_elapsed_time() {
        let before = at(2026, 7, 27, 23, 59).timestamp_millis();
        let after = at(2026, 7, 28, 0, 0).timestamp_millis();
        assert!(day_changed(before, after), "one minute across midnight is a new day");
        assert!(
            !day_changed(at(2026, 7, 27, 0, 1).timestamp_millis(), before),
            "23 hours within one day is not",
        );
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
