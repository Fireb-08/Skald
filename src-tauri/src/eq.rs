use serde::{Deserialize, Serialize};

// Audiobook-focused EQ presets. Bands map to LibVLC's fixed 10-band centres:
// 60, 170, 310, 600, 1k, 3k, 6k, 12k, 14k, 16k Hz.
pub struct Preset {
    pub name: &'static str,
    pub preamp: f32,
    pub bands: [f32; 10],
}

pub const PRESETS: &[Preset] = &[
    Preset {
        name: "Voice Clarity",
        preamp: 0.0,
        bands: [-2.0, -3.0, -4.0, -2.0, 0.0, 4.0, 2.0, 1.0, 0.0, 0.0],
    },
    Preset {
        name: "Warm Narrator",
        preamp: 0.0,
        bands: [1.0, 2.0, 0.0, -1.0, 0.0, 2.0, 0.0, -1.0, -2.0, -3.0],
    },
    Preset {
        name: "Commute",
        preamp: -2.0,
        bands: [-6.0, -5.0, -4.0, -2.0, 2.0, 6.0, 4.0, 2.0, 0.0, 0.0],
    },
    Preset {
        name: "Night Mode",
        preamp: 2.0,
        bands: [-3.0, -2.0, 0.0, 1.0, 3.0, 4.0, 2.0, 0.0, 0.0, 0.0],
    },
    Preset {
        name: "Headphones",
        preamp: 0.0,
        bands: [-3.0, -2.0, -2.0, 0.0, 0.0, 3.0, -1.0, 0.0, -1.0, -2.0],
    },
    Preset {
        name: "Speakers",
        preamp: 0.0,
        bands: [-4.0, -3.0, -2.0, -1.0, 0.0, 3.0, 2.0, 1.0, 0.0, 0.0],
    },
    Preset {
        name: "De-Harsh",
        preamp: 0.0,
        bands: [0.0, 0.0, -1.0, 0.0, 0.0, 2.0, -3.0, -2.0, -3.0, -4.0],
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqSettings {
    pub enabled: bool,
    pub preamp: f32,
    pub bands: [f32; 10],
    pub preset_name: Option<String>,
}

impl Default for EqSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            preamp: 0.0,
            bands: [0.0; 10],
            preset_name: None,
        }
    }
}

impl EqSettings {
    /// Build an EqSettings from one of the custom audiobook presets by index.
    /// Returns `None` if the index is out of range.
    pub fn from_custom_preset(index: u32) -> Option<Self> {
        let p = PRESETS.get(index as usize)?;
        Some(Self {
            enabled: true,
            preamp: p.preamp,
            bands: p.bands,
            preset_name: Some(p.name.to_string()),
        })
    }

    /// Read persisted settings from disk. Returns `Default` if the file does
    /// not exist or cannot be parsed.
    pub fn load() -> Self {
        let path = match eq_path() {
            Some(p) => p,
            None => return Self::default(),
        };
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(_) => return Self::default(),
        };
        serde_json::from_slice(&bytes).unwrap_or_default()
    }

    /// Persist settings to disk. Silently ignores I/O failures — the EQ will
    /// still work for the current session; it just won't survive a restart.
    pub fn save(&self) {
        let path = match eq_path() {
            Some(p) => p,
            None => return,
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(&path, json);
        }
    }
}

fn eq_path() -> Option<std::path::PathBuf> {
    directories::ProjectDirs::from("com", "skald", "Skald")
        .map(|dirs| dirs.data_local_dir().join("eq.json"))
}
