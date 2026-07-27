use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};

const SERVICE: &str = "skald";
const ACCOUNT: &str = "token";

/// The credential set for one ABS session.
///
/// Audiobookshelf 2.26 replaced the single long-lived token with a pair: a
/// short-lived `access` token (1h by default) and a rotating `refresh` token
/// (30d). Servers older than 2.26 — and the API-key login path, which has no
/// refresh route — still yield a single non-expiring token, kept here as
/// `legacy`. A current server actually returns *both* (`user.token` survives
/// alongside `user.accessToken`), so precedence matters: see `effective()`.
///
/// Stored as JSON in the one keyring entry Skald has always used, so an
/// existing install upgrades without a re-login — see `from_stored`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthTokens {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legacy: Option<String>,
}

impl AuthTokens {
    /// A pre-2.26 / API-key session: one non-expiring token, nothing to refresh.
    pub fn legacy(token: impl Into<String>) -> Self {
        Self {
            legacy: Some(token.into()),
            ..Default::default()
        }
    }

    /// The token to put in `Authorization: Bearer` (and in stream URLs, per
    /// critical lesson 7). Access wins over legacy: on a current server both are
    /// present, but only the access token is on the supported path.
    pub fn effective(&self) -> Option<&str> {
        self.access
            .as_deref()
            .filter(|t| !t.is_empty())
            .or_else(|| self.legacy.as_deref().filter(|t| !t.is_empty()))
    }

    /// True when this session predates the token-pair protocol. Mirrors Absorb's
    /// `AuthTokens.isLegacy`: the absence of an access token is the signal, since
    /// old servers never emit one.
    pub fn is_legacy(&self) -> bool {
        self.access.as_deref().is_none_or(str::is_empty)
    }

    /// True when a refresh is even possible — no refresh token means a 401 is
    /// terminal and the user has to sign in again.
    pub fn can_refresh(&self) -> bool {
        self.refresh.as_deref().is_some_and(|t| !t.is_empty())
    }

    /// Anything to authenticate with at all.
    pub fn is_empty(&self) -> bool {
        self.effective().is_none()
    }

    /// Unix-seconds `exp` of the access token, if it is a decodable JWT carrying
    /// one. ABS signs access tokens with `expiresIn: AccessTokenExpiry`, so the
    /// claim is always present in practice; a `None` here means "can't tell",
    /// which callers must treat as "don't refresh proactively" rather than
    /// "expired" — guessing the wrong way would refresh on every single request.
    pub fn access_expires_at(&self) -> Option<i64> {
        jwt_exp(self.access.as_deref()?)
    }

    /// Parse the keyring payload, upgrading in place.
    ///
    /// Installs predating this roadmap stored the token as a bare string. Those
    /// must keep working untouched — a failed migration is a forced re-login for
    /// every existing user — so anything that isn't JSON is read as a legacy
    /// token. A stored blob that parses as JSON but yields no usable token is
    /// also treated as a bare string, which covers the (pathological) case of a
    /// token that happens to look like JSON.
    pub fn from_stored(raw: &str) -> Self {
        let trimmed = raw.trim();
        if trimmed.starts_with('{') {
            if let Ok(parsed) = serde_json::from_str::<AuthTokens>(trimmed) {
                if !parsed.is_empty() || parsed.can_refresh() {
                    return parsed;
                }
            }
        }
        Self::legacy(raw)
    }

    /// The keyring payload. Always JSON now — `from_stored` handles the old shape
    /// on the way in, and nothing writes a bare string any more.
    pub fn to_stored(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }

    /// Human-readable session kind for diagnostics. Safe to log — it describes
    /// the credential shape, never the credential.
    pub fn kind(&self) -> &'static str {
        match (self.is_legacy(), self.can_refresh()) {
            (false, true) => "pair",
            (false, false) => "access-only",
            (true, _) if self.legacy.is_some() => "legacy",
            _ => "none",
        }
    }
}

/// Unix-seconds `exp` claim of a JWT, without verifying the signature.
///
/// Verification is the server's job — we only need to know when to ask for a new
/// token, and we hold no signing secret. Returns `None` for anything that isn't
/// a three-part JWT with a decodable payload carrying a numeric `exp` (an opaque
/// legacy token lands here, which is correct: it never expires).
fn jwt_exp(token: &str) -> Option<i64> {
    use base64::Engine;

    let payload = token.split('.').nth(1)?;
    // JWT payloads are base64url without padding.
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims.get("exp")?.as_i64()
}

fn credential_error(action: &str, error: KeyringError) -> String {
    #[cfg(target_os = "linux")]
    {
        format!(
            "Secure credential storage is unavailable while {action}. \
             Start and unlock a Secret Service-compatible keyring \
             (for example GNOME Keyring or KDE Wallet), then try again. ({error})"
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = action;
        error.to_string()
    }
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| credential_error("opening the keyring", e))
}

/// Persist the full credential set. This is the only write path that can store a
/// refresh token; `save_token` remains for single-token (API-key) sessions.
pub fn save_tokens(tokens: &AuthTokens) -> Result<(), String> {
    entry()?
        .set_password(&tokens.to_stored())
        .map_err(|e| credential_error("saving your sign-in token", e))
}

/// Load the full credential set, migrating a bare-string entry on the fly.
pub fn load_tokens() -> Result<Option<AuthTokens>, String> {
    match entry()?.get_password() {
        Ok(raw) => Ok(Some(AuthTokens::from_stored(&raw))),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(credential_error("loading your sign-in token", e)),
    }
}

/// Store a single non-refreshable token (API-key login, and any caller that only
/// ever had one token to give). Deliberately clears any previous pair rather than
/// merging: the new credential belongs to a different session than the old one.
pub fn save_token(token: &str) -> Result<(), String> {
    save_tokens(&AuthTokens::legacy(token))
}

/// The bearer token for the current session, or `None` when signed out.
///
/// Signature is unchanged from the pre-pair implementation on purpose — every
/// command in the app loads its token through here, so returning the *effective*
/// token keeps all of them correct without touching a single call site.
pub fn load_token() -> Result<Option<String>, String> {
    Ok(load_tokens()?.and_then(|t| t.effective().map(str::to_string)))
}

/// Returns Ok(()) even if no entry exists — absence is not an error.
pub fn clear_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(credential_error("removing your sign-in token", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    /// Build an unsigned JWT with the given claims payload. Only the payload
    /// segment is ever read (signatures are the server's business), so the
    /// header and signature can be filler.
    fn jwt_with_claims(claims: serde_json::Value) -> String {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&claims).unwrap());
        format!("header.{payload}.signature")
    }

    #[test]
    fn legacy_detection_and_precedence() {
        let pair = AuthTokens {
            access: Some("access-tok".into()),
            refresh: Some("refresh-tok".into()),
            legacy: Some("old-tok".into()),
        };
        // A current server sends both; the access token must win.
        assert_eq!(pair.effective(), Some("access-tok"));
        assert!(!pair.is_legacy());
        assert!(pair.can_refresh());
        assert_eq!(pair.kind(), "pair");

        let old = AuthTokens::legacy("old-tok");
        assert_eq!(old.effective(), Some("old-tok"));
        assert!(old.is_legacy());
        assert!(!old.can_refresh());
        assert_eq!(old.kind(), "legacy");

        // An empty access token is not a usable access token.
        let blank = AuthTokens {
            access: Some(String::new()),
            refresh: None,
            legacy: Some("old-tok".into()),
        };
        assert_eq!(blank.effective(), Some("old-tok"));
        assert!(blank.is_legacy());

        assert!(AuthTokens::default().is_empty());
        assert_eq!(AuthTokens::default().kind(), "none");
    }

    #[test]
    fn keyring_payload_roundtrip_and_bare_string_migration() {
        let pair = AuthTokens {
            access: Some("a".into()),
            refresh: Some("r".into()),
            legacy: None,
        };
        assert_eq!(AuthTokens::from_stored(&pair.to_stored()), pair);
        // Absent fields are omitted rather than serialized as null.
        assert!(!pair.to_stored().contains("legacy"));

        // The zero-loss upgrade: a pre-roadmap install stored the bare token.
        let migrated = AuthTokens::from_stored("eyJhbGciOiJIUzI1NiJ9.bare.token");
        assert_eq!(migrated.legacy.as_deref(), Some("eyJhbGciOiJIUzI1NiJ9.bare.token"));
        assert_eq!(migrated.effective(), Some("eyJhbGciOiJIUzI1NiJ9.bare.token"));
        assert!(migrated.is_legacy());

        // JSON-shaped but tokenless payloads must not silently sign the user out
        // by parsing to an empty set — fall back to treating it as a raw token.
        assert_eq!(AuthTokens::from_stored("{}").effective(), Some("{}"));
    }

    #[test]
    fn access_expiry_is_read_from_the_jwt_exp_claim() {
        let tokens = AuthTokens {
            access: Some(jwt_with_claims(serde_json::json!({ "exp": 1_800_000_000i64 }))),
            refresh: None,
            legacy: None,
        };
        assert_eq!(tokens.access_expires_at(), Some(1_800_000_000));

        // Opaque / non-JWT tokens report "unknown", never "expired" — callers
        // must not refresh on every request just because they can't read an exp.
        assert_eq!(AuthTokens::legacy("opaque").access_expires_at(), None);
        let no_claim = AuthTokens {
            access: Some(jwt_with_claims(serde_json::json!({ "userId": "u1" }))),
            refresh: None,
            legacy: None,
        };
        assert_eq!(no_claim.access_expires_at(), None);
    }
}
