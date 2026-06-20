// probe.rs — read embedded metadata + chapters via the bundled `ffprobe` binary
// (the same approach Audiobookshelf uses). ffprobe normalizes container tags and
// reads chapters with start/end times, which lofty cannot do. MP4 freeform atoms
// (`----:com.apple.iTunes:SERIES`) surface as their bare name (`SERIES`), so we
// match keys case-insensitively with alternates, mirroring ABS's `tryGrabTags`.
//
// The binary is resolved next to the executable (build.rs copies it / Tauri
// bundles it), falling back to `ffprobe` on PATH.

use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

static FFPROBE: OnceLock<PathBuf> = OnceLock::new();

/// Record the resolved ffprobe path (called once at app setup from the resource dir).
pub fn set_ffprobe_path(p: PathBuf) {
    let _ = FFPROBE.set(p);
}

fn ffprobe_bin() -> PathBuf {
    FFPROBE.get().cloned().unwrap_or_else(|| PathBuf::from("ffprobe"))
}

/// One embedded chapter (seconds).
pub struct Chapter {
    pub start: f64,
    pub end: f64,
    pub title: String,
}

/// Everything the scanner needs from one audio file.
#[derive(Default)]
pub struct ProbedFile {
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub author: Option<String>,
    pub narrator: Option<String>,
    pub series: Option<String>,
    pub series_sequence: Option<String>,
    pub publisher: Option<String>,
    pub year: Option<String>,
    pub language: Option<String>,
    pub isbn: Option<String>,
    pub asin: Option<String>,
    pub description: Option<String>,
    pub genres: Vec<String>,
    pub duration_secs: f64,
    pub has_cover: bool,
    pub chapters: Vec<Chapter>,
}

/// Run ffprobe over a file and return its parsed JSON (`format`, `streams`,
/// `chapters`). The path is passed as a literal process argument with the `file:`
/// protocol so ffmpeg never reinterprets it as a URL/pattern.
pub fn probe(path: &Path) -> Result<Value, String> {
    let arg = format!("file:{}", path.to_string_lossy());
    let out = Command::new(ffprobe_bin())
        .args([
            "-hide_banner", "-loglevel", "error",
            "-print_format", "json",
            "-show_format", "-show_streams", "-show_chapters",
        ])
        .arg(&arg)
        .output()
        .map_err(|e| format!("ffprobe spawn failed (is it bundled?): {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "ffprobe exit {:?}: {}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("ffprobe json parse: {e}"))
}

/// Probe one file and map its tags/chapters into a `ProbedFile`. Never fails: an
/// unreadable file yields an empty struct (it still counts as a track).
pub fn probe_file(path: &Path) -> ProbedFile {
    let v = match probe(path) {
        Ok(v) => v,
        Err(e) => {
            log::warn!(target: "skald::library", "ffprobe failed for {}: {e}", path.display());
            return ProbedFile::default();
        }
    };

    // Case-insensitive tag map. Format (container) tags win over stream tags.
    let mut tags: HashMap<String, String> = HashMap::new();
    let mut add = |obj: Option<&serde_json::Map<String, Value>>| {
        if let Some(o) = obj {
            for (k, val) in o {
                if let Some(s) = val.as_str() {
                    let s = s.trim();
                    if !s.is_empty() {
                        tags.entry(k.to_lowercase()).or_insert_with(|| s.to_string());
                    }
                }
            }
        }
    };
    // Stream tags first (lower priority), then format (overrides via insert below).
    if let Some(streams) = v.get("streams").and_then(|s| s.as_array()) {
        for st in streams {
            add(st.get("tags").and_then(|t| t.as_object()));
        }
    }
    // Format tags take precedence — re-insert overriding stream values.
    if let Some(fmt) = v.get("format").and_then(|f| f.get("tags")).and_then(|t| t.as_object()) {
        for (k, val) in fmt {
            if let Some(s) = val.as_str() {
                let s = s.trim();
                if !s.is_empty() {
                    tags.insert(k.to_lowercase(), s.to_string());
                }
            }
        }
    }

    // First non-empty alternate (keys compared lowercase, matching ABS tryGrabTags).
    let grab = |alts: &[&str]| -> Option<String> {
        alts.iter().find_map(|a| tags.get(&a.to_lowercase()).cloned())
    };

    let mut f = ProbedFile {
        title: grab(&["album", "title"]),
        subtitle: grab(&["subtitle", "tit3", "tt3"]),
        author: grab(&["album_artist", "albumartist", "artist", "author"]),
        narrator: grab(&["narrator", "composer", "tcom", "tcm"]),
        series: grab(&["series", "show", "mvnm", "movement"]),
        series_sequence: grab(&["series-part", "seriespart", "part", "movement-index"]),
        publisher: grab(&["publisher", "label", "tpub", "tpb"]),
        year: grab(&["date", "year", "originalyear", "tyer", "tdrc"]).map(|y| year4(&y)),
        language: grab(&["language", "lang"]),
        isbn: grab(&["isbn"]),
        asin: grab(&["asin", "audible_asin"]),
        description: grab(&["description", "desc", "comment", "comm"]),
        genres: grab(&["genre", "tcon", "tco"])
            .map(|g| {
                g.split(['/', ';'])
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        ..Default::default()
    };

    // Duration from the container.
    f.duration_secs = v
        .get("format")
        .and_then(|fm| fm.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);

    // Cover: an attached-picture video stream.
    f.has_cover = v
        .get("streams")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter().any(|st| {
                st.get("codec_type").and_then(|c| c.as_str()) == Some("video")
                    && st.get("disposition").and_then(|d| d.get("attached_pic")).and_then(|p| p.as_i64()) == Some(1)
            })
        })
        .unwrap_or(false);

    // Embedded chapters (start_time/end_time are seconds as strings).
    if let Some(chs) = v.get("chapters").and_then(|c| c.as_array()) {
        for c in chs {
            let start = c.get("start_time").and_then(|s| s.as_str()).and_then(|s| s.parse().ok()).unwrap_or(0.0);
            let end = c.get("end_time").and_then(|s| s.as_str()).and_then(|s| s.parse().ok()).unwrap_or(start);
            let title = c
                .get("tags")
                .and_then(|t| t.get("title"))
                .and_then(|t| t.as_str())
                .map(str::to_string)
                .unwrap_or_default();
            f.chapters.push(Chapter { start, end, title });
        }
    }

    f
}

/// Narrow a date tag (e.g. "2021-05-04") to a 4-digit year; pass others through.
fn year4(s: &str) -> String {
    let digits: String = s.trim().chars().take(4).collect();
    if digits.len() == 4 && digits.chars().all(|c| c.is_ascii_digit()) {
        digits
    } else {
        s.trim().to_string()
    }
}
