use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "skald";
const ACCOUNT: &str = "token";

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

pub fn save_token(token: &str) -> Result<(), String> {
    entry()?
        .set_password(token)
        .map_err(|e| credential_error("saving your sign-in token", e))
}

pub fn load_token() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(credential_error("loading your sign-in token", e)),
    }
}

/// Returns Ok(()) even if no entry exists — absence is not an error.
pub fn clear_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(credential_error("removing your sign-in token", e)),
    }
}
