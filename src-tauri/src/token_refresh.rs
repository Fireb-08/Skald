//! Access-token refresh for ABS 2.26+ sessions.
//!
//! ABS access tokens live one hour; Skald sessions live as long as the window is
//! open. This module keeps the stored credential set ahead of that expiry so the
//! ~110 command call sites can keep doing what they already do — load a token,
//! build a client, make a call — without any of them knowing refresh exists.
//!
//! Two rules from the ABS source drive the design (see the roadmap's verified
//! protocol notes):
//!
//! 1. **Persist before use.** `/auth/refresh` rotates the refresh token. If we
//!    used a rotated pair without writing it down first and then crashed, the
//!    on-disk session would hold a *consumed* refresh token and an expired access
//!    token — unrecoverable without a re-login.
//! 2. **One refresh at a time.** Concurrent commands would otherwise each spend
//!    the same refresh token. ABS does cushion this with a 10-minute grace window
//!    on the previous token, but that is a race-condition backstop, not a licence
//!    to stampede.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::api::AbsClient;
use crate::auth::{self, AuthTokens};

/// Refresh once the access token has less than this long to live. Generous
/// relative to the 1-hour TTL: the cost of an early refresh is one cheap request,
/// the cost of a late one is a failed user-visible action.
const REFRESH_SKEW_SECONDS: i64 = 300;

/// Serializes refresh attempts across the whole process — the single-flight latch.
static REFRESH_LOCK: Mutex<()> = Mutex::const_new(());

/// Set when a server answers `/auth/refresh` with 404, i.e. it predates 2.26 and
/// has no refresh route. Stops us re-probing a route that will never exist.
/// Cleared by `reset_for_new_session` when the signed-in server may have changed.
static SERVER_LACKS_REFRESH: AtomicBool = AtomicBool::new(false);

/// App handle for emitting `auth-expired`.
///
/// Refresh happens deep inside API calls that have no handle to pass down — a
/// `get_libraries()` three layers below a command knows nothing about Tauri. The
/// alternative, threading an `AppHandle` through every one of those call sites,
/// would be far more invasive than one process-wide handle set at startup.
static APP: OnceLock<AppHandle> = OnceLock::new();

/// Called once from the Tauri `setup()` hook.
pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

/// Forget per-server refresh state. Call on login and logout: the legacy flag
/// describes *a* server, and the next session may be a different one.
pub fn reset_for_new_session() {
    SERVER_LACKS_REFRESH.store(false, Ordering::Relaxed);
}

/// True when `tokens` should be refreshed before use.
///
/// Deliberately conservative about the unknown: a token whose `exp` we cannot
/// read reports `None`, and we leave it alone rather than refreshing on every
/// single request forever. A refresh token with no access token beside it is the
/// one case we refresh eagerly — there is nothing else to authenticate with.
fn needs_refresh(tokens: &AuthTokens, now: i64) -> bool {
    if !tokens.can_refresh() {
        return false;
    }
    match tokens.access_expires_at() {
        Some(exp) => exp - now <= REFRESH_SKEW_SECONDS,
        // No access token at all, but we hold a refresh token: get one.
        None => tokens.is_legacy(),
    }
}

/// The credential set for `server_url`, refreshed first if it is at or near
/// expiry. This is the accessor every authenticated request goes through.
///
/// Refresh failures that are *not* fatal (no refresh token, old server, network
/// hiccup) return the existing tokens and let the request proceed — it may well
/// still work, and a hard error here would break an app that was functioning.
/// Only a definitively dead session propagates an error.
pub async fn fresh_tokens(server_url: &str) -> Result<AuthTokens, String> {
    let tokens =
        auth::load_tokens()?.ok_or_else(|| "Not authenticated: no token stored".to_string())?;

    if !needs_refresh(&tokens, now_seconds()) {
        return Ok(tokens);
    }
    refresh_now(server_url, tokens, false).await
}

/// Refresh unconditionally — the reactive path, for a request that has just been
/// told 401 by the server even though the token looked current (revoked session,
/// clock skew, a password change elsewhere).
pub async fn force_refresh(server_url: &str) -> Result<AuthTokens, String> {
    let tokens =
        auth::load_tokens()?.ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    refresh_now(server_url, tokens, true).await
}

/// The single-flight body. `observed` is the caller's view of the credential set
/// before it queued for the lock. `force` skips the expiry check: the server has
/// already rejected the token, so what its `exp` claims is beside the point.
async fn refresh_now(
    server_url: &str,
    observed: AuthTokens,
    force: bool,
) -> Result<AuthTokens, String> {
    if SERVER_LACKS_REFRESH.load(Ordering::Relaxed) || !observed.can_refresh() {
        // Nothing to do and nothing to report: a legacy session's token does not
        // expire, so proceeding with it is correct.
        return Ok(observed);
    }

    let _guard = REFRESH_LOCK.lock().await;

    // Re-read after taking the lock. If another task rotated while we waited, its
    // result is already on disk and is the one to use — spending our (now
    // superseded) refresh token would be the double-refresh bug.
    let current = auth::load_tokens()?.unwrap_or_default();
    if current.refresh != observed.refresh {
        log::debug!(
            target: "skald::auth",
            "refresh already completed by another task; using the stored pair"
        );
        return Ok(current);
    }
    if !force && !needs_refresh(&current, now_seconds()) {
        return Ok(current);
    }

    let refresh_token = match current.refresh.as_deref() {
        Some(t) => t,
        None => return Ok(current),
    };

    match AbsClient::new(server_url.to_string())
        .refresh_tokens(refresh_token)
        .await
    {
        Ok(outcome) => {
            let rotated = AuthTokens {
                access: outcome.tokens.access,
                // The server returns the rotated refresh token because we send it
                // via the x-refresh-token header. Keep the old one if it somehow
                // did not — inside the grace window it still works, and dropping
                // it would end the session needlessly.
                refresh: outcome.tokens.refresh.or(current.refresh.clone()),
                // /auth/refresh re-sends the profile's legacy token; prefer
                // whichever is present so we never lose the fallback.
                legacy: outcome.tokens.legacy.or(current.legacy.clone()),
            };

            // Persist before anything else touches these values (rule 1).
            auth::save_tokens(&rotated)?;

            let rotated_refresh = rotated.refresh != current.refresh;
            log::info!(
                target: "skald::auth",
                "access token refreshed (refresh token rotated: {rotated_refresh})"
            );

            // Consumers holding a copy of the old token need the new one — the
            // socket most of all, since it authenticates once at connect.
            if let Some(token) = rotated.effective() {
                notify_token_changed(token);
            }
            Ok(rotated)
        }
        Err(e) if is_not_found(&e) => {
            // Pre-2.26 server: the route does not exist. The legacy token we hold
            // does not expire, so this is not a failure — just stop asking.
            SERVER_LACKS_REFRESH.store(true, Ordering::Relaxed);
            log::info!(
                target: "skald::auth",
                "server has no /auth/refresh route — treating this session as legacy"
            );
            Ok(current)
        }
        Err(e) if is_unauthorized(&e) => {
            // The refresh token is spent, expired, or revoked. This session is
            // over; only the user can fix it.
            log::warn!(target: "skald::auth", "refresh rejected, session ended: {e}");
            emit_auth_expired();
            Err(format!("Your session has expired. Please sign in again. ({e})"))
        }
        Err(e) => {
            // Network/transport trouble. The access token may still have life in
            // it (we refresh early on purpose), so let the caller try.
            log::warn!(target: "skald::auth", "refresh attempt failed, continuing with the current token: {e}");
            Ok(current)
        }
    }
}

/// `refresh_tokens` formats transport and status failures into one string; these
/// two read the status back out of it. Narrow by design — anything unrecognized
/// is treated as a transient error, which fails safe (retry later) rather than
/// signing the user out on a blip.
fn is_not_found(err: &str) -> bool {
    err.contains("HTTP 404")
}

fn is_unauthorized(err: &str) -> bool {
    err.contains("HTTP 401") || err.contains("HTTP 403")
}

fn now_seconds() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Counts `auth-expired` emissions so tests can assert the event fired without a
/// running Tauri app to listen on.
#[cfg(test)]
static AUTH_EXPIRED_EMITS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Tell the frontend the session is unrecoverable so it can route to Login.
fn emit_auth_expired() {
    #[cfg(test)]
    AUTH_EXPIRED_EMITS.fetch_add(1, Ordering::Relaxed);

    if let Some(app) = APP.get() {
        let _ = app.emit("auth-expired", ());
    }
}

/// Announce a rotated token to in-process consumers that cached the old one.
/// Carries no token — listeners re-read the keyring — so the value never crosses
/// the IPC boundary or lands in a log.
fn notify_token_changed(_token: &str) {
    if let Some(app) = APP.get() {
        let _ = app.emit("auth-token-refreshed", ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    fn access_expiring_in(seconds: i64) -> String {
        let claims = serde_json::json!({ "exp": now_seconds() + seconds });
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&claims).unwrap());
        format!("header.{payload}.sig")
    }

    fn pair(access: String) -> AuthTokens {
        AuthTokens {
            access: Some(access),
            refresh: Some("refresh-tok".into()),
            legacy: None,
        }
    }

    #[test]
    fn refresh_is_due_only_inside_the_skew_window() {
        let now = now_seconds();
        assert!(!needs_refresh(&pair(access_expiring_in(3600)), now));
        // Exactly at the boundary counts as due.
        assert!(needs_refresh(&pair(access_expiring_in(REFRESH_SKEW_SECONDS)), now));
        assert!(needs_refresh(&pair(access_expiring_in(-1)), now));
    }

    #[test]
    fn sessions_that_cannot_refresh_are_never_due() {
        let now = now_seconds();
        // Legacy tokens do not expire and there is no refresh token to spend.
        assert!(!needs_refresh(&AuthTokens::legacy("old-tok"), now));
        assert!(!needs_refresh(&AuthTokens::default(), now));

        // An access token we cannot read an exp from must not trigger a refresh
        // on every request — "unknown" is not "expired".
        let opaque = AuthTokens {
            access: Some("opaque-not-a-jwt".into()),
            refresh: Some("refresh-tok".into()),
            legacy: None,
        };
        assert!(!needs_refresh(&opaque, now));
    }

    #[test]
    fn a_refresh_token_with_no_access_token_refreshes_eagerly() {
        let orphaned = AuthTokens {
            access: None,
            refresh: Some("refresh-tok".into()),
            legacy: None,
        };
        assert!(needs_refresh(&orphaned, now_seconds()));
    }

    #[test]
    fn refresh_errors_are_classified_by_status() {
        assert!(is_not_found("refresh failed: HTTP 404 Not Found"));
        assert!(is_unauthorized("refresh failed: HTTP 401 Unauthorized Refresh token expired"));
        // A transport failure is neither — it must fail safe as transient.
        let transport = "error sending request for url (http://x/auth/refresh)";
        assert!(!is_not_found(transport) && !is_unauthorized(transport));
    }
}

/// HTTP contract tests for `/auth/refresh`, run against a mock ABS server.
///
/// These assert the wire details verified against the ABS source — the route
/// path, the `x-refresh-token` header, and the `user.accessToken` /
/// `user.refreshToken` response shape — plus the two behaviours that protect a
/// rotating single-use credential: persist-before-use and single-flight.
#[cfg(test)]
mod contract_tests {
    use super::*;
    use base64::Engine;
    use std::sync::atomic::AtomicUsize;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// The module's statics (stored tokens, the legacy flag, the emit counter)
    /// are process-wide, so these tests must not interleave.
    static SERIAL: Mutex<()> = Mutex::const_new(());

    struct TestEnv {
        server: MockServer,
        _guard: tokio::sync::MutexGuard<'static, ()>,
    }

    async fn setup() -> TestEnv {
        let guard = SERIAL.lock().await;
        auth::test_keyring::clear();
        reset_for_new_session();
        AUTH_EXPIRED_EMITS.store(0, Ordering::Relaxed);
        TestEnv {
            server: MockServer::start().await,
            _guard: guard,
        }
    }

    fn expired_access() -> String {
        let claims = serde_json::json!({ "exp": now_seconds() - 60 });
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&claims).unwrap());
        format!("header.{payload}.sig")
    }

    /// A long-lived access token. `id` distinguishes otherwise-identical tokens
    /// so a test can tell "the server issued a new one" from "nothing changed" —
    /// the exact distinction `send_authed` makes before retrying.
    fn fresh_access(id: &str) -> String {
        let claims = serde_json::json!({ "exp": now_seconds() + 3600, "jti": id });
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&claims).unwrap());
        format!("header.{payload}.sig")
    }

    /// Seed the keyring seam with an about-to-expire pair.
    fn seed_expiring_pair() {
        auth::save_tokens(&AuthTokens {
            access: Some(expired_access()),
            refresh: Some("refresh-v1".into()),
            legacy: None,
        })
        .unwrap();
    }

    /// A `/auth/refresh` success body, shaped exactly as ABS builds it.
    fn refresh_body(access: &str, refresh: &str) -> serde_json::Value {
        serde_json::json!({
            "user": {
                "id": "u1",
                "username": "listener",
                "type": "user",
                "isActive": true,
                "token": null,
                "accessToken": access,
                "refreshToken": refresh,
            },
            "userDefaultLibraryId": "lib1",
        })
    }

    #[tokio::test]
    async fn expiring_token_refreshes_with_the_x_refresh_token_header() {
        let env = setup().await;
        let new_access = fresh_access("v2");

        Mock::given(method("POST"))
            .and(path("/auth/refresh"))
            .and(header("x-refresh-token", "refresh-v1"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(refresh_body(&new_access, "refresh-v2")),
            )
            .expect(1)
            .mount(&env.server)
            .await;

        seed_expiring_pair();
        let tokens = fresh_tokens(&env.server.uri()).await.unwrap();

        assert_eq!(tokens.access.as_deref(), Some(new_access.as_str()));
        assert_eq!(tokens.refresh.as_deref(), Some("refresh-v2"));
    }

    #[tokio::test]
    async fn rotation_is_persisted_before_the_new_tokens_are_handed_back() {
        let env = setup().await;
        let new_access = fresh_access("v2");

        Mock::given(method("POST"))
            .and(path("/auth/refresh"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(refresh_body(&new_access, "refresh-v2")),
            )
            .mount(&env.server)
            .await;

        seed_expiring_pair();
        let returned = fresh_tokens(&env.server.uri()).await.unwrap();

        // The stranded-session guard: whatever the caller got must already be on
        // disk. If a crash happened right here, the stored refresh token must be
        // the live one — not the spent `refresh-v1`.
        let stored = auth::load_tokens().unwrap().unwrap();
        assert_eq!(stored, returned);
        assert_eq!(stored.refresh.as_deref(), Some("refresh-v2"));
    }

    #[tokio::test]
    async fn concurrent_callers_produce_exactly_one_refresh() {
        let env = setup().await;
        let new_access = fresh_access("v2");

        // `expect(1)` is the assertion: a second call would spend a token the
        // server has already rotated away.
        Mock::given(method("POST"))
            .and(path("/auth/refresh"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(std::time::Duration::from_millis(50))
                    .set_body_json(refresh_body(&new_access, "refresh-v2")),
            )
            .expect(1)
            .mount(&env.server)
            .await;

        seed_expiring_pair();
        let uri = env.server.uri();
        let results = futures_util::future::join_all(
            (0..8).map(|_| {
                let uri = uri.clone();
                tokio::spawn(async move { fresh_tokens(&uri).await })
            }),
        )
        .await;

        for r in results {
            let tokens = r.unwrap().unwrap();
            assert_eq!(tokens.refresh.as_deref(), Some("refresh-v2"));
        }
    }

    #[tokio::test]
    async fn a_404_marks_the_server_legacy_and_stops_further_attempts() {
        let env = setup().await;

        // expect(1): after the first 404 we must never probe the route again.
        Mock::given(method("POST"))
            .and(path("/auth/refresh"))
            .respond_with(ResponseTemplate::new(404))
            .expect(1)
            .mount(&env.server)
            .await;

        seed_expiring_pair();
        let uri = env.server.uri();

        // The session keeps working on the token it already has — an old server's
        // token does not expire, so this is not an error path.
        for _ in 0..3 {
            let tokens = fresh_tokens(&uri).await.unwrap();
            assert_eq!(tokens.refresh.as_deref(), Some("refresh-v1"));
        }
        assert!(SERVER_LACKS_REFRESH.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn a_dead_refresh_token_ends_the_session_and_emits_auth_expired() {
        let env = setup().await;

        Mock::given(method("POST"))
            .and(path("/auth/refresh"))
            .respond_with(
                ResponseTemplate::new(401)
                    .set_body_json(serde_json::json!({ "error": "Refresh token expired" })),
            )
            .mount(&env.server)
            .await;

        seed_expiring_pair();
        let err = fresh_tokens(&env.server.uri()).await.unwrap_err();

        assert!(err.contains("sign in again"), "user-facing message: {err}");
        assert_eq!(AUTH_EXPIRED_EMITS.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn a_transient_failure_keeps_the_session_alive() {
        let env = setup().await;

        // A 500 is not a statement about the credential. Signing the user out
        // over a blip would be worse than letting the request try its luck.
        Mock::given(method("POST"))
            .and(path("/auth/refresh"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&env.server)
            .await;

        seed_expiring_pair();
        let tokens = fresh_tokens(&env.server.uri()).await.unwrap();

        assert_eq!(tokens.refresh.as_deref(), Some("refresh-v1"));
        assert_eq!(AUTH_EXPIRED_EMITS.load(Ordering::Relaxed), 0);
        assert!(!SERVER_LACKS_REFRESH.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn a_current_token_is_used_without_contacting_the_server() {
        let env = setup().await;

        // No mock is mounted: any request at all would 404 and fail the run.
        auth::save_tokens(&AuthTokens {
            access: Some(fresh_access("v1")),
            refresh: Some("refresh-v1".into()),
            legacy: None,
        })
        .unwrap();

        let tokens = fresh_tokens(&env.server.uri()).await.unwrap();
        assert_eq!(tokens.refresh.as_deref(), Some("refresh-v1"));
        assert!(env.server.received_requests().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_401_response_triggers_one_refresh_and_one_retry() {
        let env = setup().await;
        let new_access = fresh_access("v2");
        let calls = std::sync::Arc::new(AtomicUsize::new(0));

        Mock::given(method("POST"))
            .and(path("/auth/refresh"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(refresh_body(&new_access, "refresh-v2")),
            )
            .expect(1)
            .mount(&env.server)
            .await;

        // The protected endpoint rejects the first (stale) token and accepts the
        // refreshed one — the scenario proactive expiry maths cannot predict.
        Mock::given(method("GET"))
            .and(path("/api/me"))
            .respond_with({
                let calls = calls.clone();
                move |_: &wiremock::Request| {
                    let n = calls.fetch_add(1, Ordering::Relaxed);
                    if n == 0 {
                        ResponseTemplate::new(401)
                    } else {
                        ResponseTemplate::new(200).set_body_json(serde_json::json!({ "ok": true }))
                    }
                }
            })
            .mount(&env.server)
            .await;

        // A token that still looks valid, so only the 401 can drive the refresh.
        auth::save_tokens(&AuthTokens {
            access: Some(fresh_access("v1")),
            refresh: Some("refresh-v1".into()),
            legacy: None,
        })
        .unwrap();

        let uri = env.server.uri();
        let client = AbsClient::authenticated(uri.clone()).await.unwrap();
        let resp = client
            .send_authed(|token| {
                client
                    .http
                    .get(format!("{uri}/api/me"))
                    .header("Authorization", format!("Bearer {token}"))
            })
            .await
            .unwrap();

        assert_eq!(resp.status(), 200);
        // Exactly twice: the original and one retry. Never a loop.
        assert_eq!(calls.load(Ordering::Relaxed), 2);
    }

    #[tokio::test]
    async fn a_legacy_session_does_not_retry_a_401() {
        let env = setup().await;
        let calls = std::sync::Arc::new(AtomicUsize::new(0));

        Mock::given(method("GET"))
            .and(path("/api/me"))
            .respond_with({
                let calls = calls.clone();
                move |_: &wiremock::Request| {
                    calls.fetch_add(1, Ordering::Relaxed);
                    ResponseTemplate::new(401)
                }
            })
            .mount(&env.server)
            .await;

        // No refresh token: there is nothing to exchange, so retrying would just
        // reproduce the same 401 against the same server.
        auth::save_tokens(&AuthTokens::legacy("old-tok")).unwrap();

        let uri = env.server.uri();
        let client = AbsClient::authenticated(uri.clone()).await.unwrap();
        let resp = client
            .send_authed(|token| {
                client
                    .http
                    .get(format!("{uri}/api/me"))
                    .header("Authorization", format!("Bearer {token}"))
            })
            .await
            .unwrap();

        assert_eq!(resp.status(), 401);
        assert_eq!(calls.load(Ordering::Relaxed), 1);
    }
}
