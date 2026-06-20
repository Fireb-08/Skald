// tone.rs — write embedded metadata via the bundled `tone` binary (sandreas/tone,
// Apache-2.0), the audiobook-native tagger Audiobookshelf uses for its "Embed
// Metadata" feature. ffmpeg/ffprobe read well but can't cleanly write m4b tags +
// chapters; `tone tag` can. Standard audiobook fields map to dedicated flags;
// the rest go through `--meta-additional-field NAME=VALUE` freeform atoms (which
// ffprobe reads back by bare name — see probe.rs).

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

static TONE: OnceLock<PathBuf> = OnceLock::new();

/// Record the resolved tone path (called once at app setup from the resource dir).
pub fn set_tone_path(p: PathBuf) {
    let _ = TONE.set(p);
}

const AUDIO_EXTS: &[&str] = &["m4b", "mp3", "aac", "ogg", "flac", "opus", "m4a", "wav"];

fn is_audio(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn push(args: &mut Vec<String>, flag: &str, v: &Option<String>) {
    if let Some(v) = v {
        args.push(flag.to_string());
        args.push(v.clone());
    }
}

/// Write album-level metadata into every audio file in a book folder via `tone`.
/// Mirrors the field set the Match/Edit review screens expose. Best-effort per
/// file; returns the first error (e.g. a file locked by playback). Errors if the
/// tone binary isn't bundled — the caller then keeps the catalog-only metadata.
pub fn write_book_tags(dir: &Path, meta: &Value) -> Result<(), String> {
    let Some(tone) = TONE.get().cloned() else {
        return Err("tone binary not available".to_string());
    };

    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| format!("read book dir: {e}"))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| is_audio(p))
        .collect();
    files.sort();

    let s = |k: &str| {
        meta.get(k)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|x| !x.is_empty())
            .map(str::to_string)
    };
    // tone takes a single --meta-genre; join multiple with "/" (ffprobe/probe.rs
    // splits genre on "/" and ";" on the way back in).
    let genres = meta
        .get("genres")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .map(str::trim)
                .filter(|x| !x.is_empty())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default();

    let mut first_err: Option<String> = None;
    for f in &files {
        let mut args: Vec<String> = vec!["tag".to_string()];
        push(&mut args, "--meta-album", &s("title"));
        push(&mut args, "--meta-album-artist", &s("authorName"));
        push(&mut args, "--meta-artist", &s("authorName"));
        push(&mut args, "--meta-narrator", &s("narratorName"));
        push(&mut args, "--meta-composer", &s("narratorName"));
        push(&mut args, "--meta-movement-name", &s("seriesName"));
        push(&mut args, "--meta-part", &s("seriesSequence"));
        push(&mut args, "--meta-publisher", &s("publisher"));
        push(&mut args, "--meta-recording-date", &s("publishedYear"));
        push(&mut args, "--meta-subtitle", &s("subtitle"));
        push(&mut args, "--meta-description", &s("description"));
        if !genres.is_empty() {
            args.push("--meta-genre".to_string());
            args.push(genres.clone());
        }
        // Fields without a dedicated flag → freeform atoms (ffprobe reads by name).
        for (name, key) in [("LANGUAGE", "language"), ("ISBN", "isbn"), ("ASIN", "asin")] {
            if let Some(v) = s(key) {
                args.push("--meta-additional-field".to_string());
                args.push(format!("{name}={v}"));
            }
        }
        args.push(f.to_string_lossy().into_owned());

        match Command::new(&tone).args(&args).output() {
            Ok(out) if out.status.success() => {}
            Ok(out) => {
                let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
                log::warn!(target: "skald::metadata", "tone tag failed {}: {msg}", f.display());
                if first_err.is_none() {
                    first_err = Some(msg);
                }
            }
            Err(e) => {
                log::warn!(target: "skald::metadata", "tone spawn failed {}: {e}", f.display());
                if first_err.is_none() {
                    first_err = Some(e.to_string());
                }
            }
        }
    }

    match first_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}
