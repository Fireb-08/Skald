use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSyncCadence {
    pub online_session_seconds: u64,
    pub offline_flush_seconds: u64,
    pub seek_debounce_milliseconds: u64,
    pub focus_reconcile_minimum_milliseconds: u64,
}

/// Parse the frontend-visible JSON once so Rust and React consume the same
/// cadence definition. A malformed checked-in file is a build/test defect.
pub fn playback_sync_cadence() -> &'static PlaybackSyncCadence {
    static CADENCE: OnceLock<PlaybackSyncCadence> = OnceLock::new();
    CADENCE.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/config/playbackSync.json"))
            .expect("src/config/playbackSync.json must be valid")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_playback_sync_cadence_has_reviewed_values() {
        let cadence = playback_sync_cadence();
        assert_eq!(cadence.online_session_seconds, 10);
        assert_eq!(cadence.offline_flush_seconds, 30);
        assert_eq!(cadence.seek_debounce_milliseconds, 750);
        assert_eq!(cadence.focus_reconcile_minimum_milliseconds, 15_000);
    }
}
