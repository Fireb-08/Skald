// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

// ── Equalizer commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_eq_presets() -> Result<Vec<models::EqPreset>, String> {
    Ok(crate::eq::PRESETS
        .iter()
        .enumerate()
        .map(|(i, p)| models::EqPreset { index: i as u32, name: p.name.to_string() })
        .collect())
}

#[tauri::command]
pub fn get_eq_band_frequencies() -> Result<Vec<f32>, String> {
    Ok(audio::eq_band_frequencies())
}

#[tauri::command]
pub fn get_eq_settings() -> Result<EqSettings, String> {
    Ok(EqSettings::load())
}

#[tauri::command]
pub async fn set_eq_enabled(
    enabled: bool,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    let mut settings = EqSettings::load();
    settings.enabled = enabled;
    if let Some(p) = guard.as_ref() {
        p.apply_eq_settings(&settings);
    }
    settings.save();
    Ok(())
}

#[tauri::command]
pub async fn set_eq_band(
    band: u32,
    gain: f32,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    let mut settings = EqSettings::load();
    if (band as usize) < settings.bands.len() {
        settings.bands[band as usize] = gain;
        settings.preset_name = None; // manual band adjust → clear preset label
    }
    if let Some(p) = guard.as_ref() {
        p.set_eq_band(band, gain);
    }
    settings.save();
    Ok(())
}

#[tauri::command]
pub async fn set_eq_preamp(
    gain: f32,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    let mut settings = EqSettings::load();
    settings.preamp = gain;
    if let Some(p) = guard.as_ref() {
        p.set_eq_preamp(gain);
    }
    settings.save();
    Ok(())
}

#[tauri::command]
pub async fn apply_eq_preset(
    index: u32,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    let settings = EqSettings::from_custom_preset(index)
        .unwrap_or_default();
    if let Some(p) = guard.as_ref() {
        p.apply_eq_settings(&settings);
    }
    settings.save();
    Ok(())
}

#[tauri::command]
pub async fn reset_eq(
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    let settings = EqSettings::default();
    if let Some(p) = guard.as_ref() {
        p.apply_eq_settings(&settings); // applies zeros + disables (enabled: false)
    }
    settings.save();
    Ok(())
}
