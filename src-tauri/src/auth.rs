use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "skald";
const ACCOUNT: &str = "token";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

pub fn save_token(token: &str) -> Result<(), String> {
    entry()?.set_password(token).map_err(|e| e.to_string())
}

pub fn load_token() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(token) => {
            eprintln!("[auth] loaded token from keyring — length: {}", token.len());
            Ok(Some(token))
        }
        Err(KeyringError::NoEntry) => {
            eprintln!("[auth] no token in keyring (NoEntry)");
            Ok(None)
        }
        Err(e) => {
            eprintln!("[auth] keyring get_password failed: {:?}", e);
            Err(e.to_string())
        }
    }
}

/// Returns Ok(()) even if no entry exists — absence is not an error.
pub fn clear_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
