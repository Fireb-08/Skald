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
#[cfg(windows)]
use std::os::windows::process::CommandExt;

// Run the bundled console-subsystem tone.exe with no flashing command-prompt window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

        let mut cmd = Command::new(&tone);
        cmd.args(&args);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        // Rewriting tags on a large m4b can be slow, but a hung tone must not
        // stall the write-back forever (see probe::output_with_timeout).
        match crate::probe::output_with_timeout(&mut cmd, std::time::Duration::from_secs(300)) {
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

/// Format seconds as the `HH:MM:SS.fff` timestamp tone's ChptFmtNative parser
/// expects (hours are >= 2 digits; minutes/seconds 2; milliseconds 3). Mirrors
/// tone's own `FormatTimeSpan`, so a write here round-trips through its reader.
fn fmt_ts(secs: f64) -> String {
    let ms_total = (secs.max(0.0) * 1000.0).round() as i64;
    let h = ms_total / 3_600_000;
    let m = (ms_total % 3_600_000) / 60_000;
    let s = (ms_total % 60_000) / 1000;
    let ms = ms_total % 1000;
    format!("{h:02}:{m:02}:{s:02}.{ms:03}")
}

/// Write a chapter list into a single audio file via tone's `--meta-chapters-file`
/// import (the ChptFmtNative format — verified against tone's
/// ChptFmtNativeMetadataFormat parser). `chapters` is the ABS-shaped array
/// (objects with numeric `start` seconds + `title`); `total_duration` is the
/// file's duration in seconds, emitted as the `## total-duration:` header so the
/// final chapter gets an end (tone derives every other end from the next line's
/// start). Best-effort by design: returns Err on any tone failure (e.g. a file
/// locked by playback, or a container tone can't tag) so the caller keeps the
/// authoritative catalog edit and surfaces a soft warning. Caller must ensure the
/// target is a single-file book — multi-file chapter write-back is ambiguous.
pub fn write_chapters(file: &Path, chapters: &Value, total_duration: f64) -> Result<(), String> {
    let Some(tone) = TONE.get().cloned() else {
        return Err("tone binary not available".to_string());
    };
    let arr = chapters
        .as_array()
        .ok_or_else(|| "chapters must be an array".to_string())?;
    if arr.is_empty() {
        return Err("no chapters to write".to_string());
    }

    // Build the chapters file. Titles are single-line: a newline would be read as
    // the start of a new (invalid) chapter line, so they're flattened to spaces.
    let mut body = String::new();
    if total_duration > 0.0 {
        body.push_str(&format!("## total-duration: {}\n", fmt_ts(total_duration)));
    }
    for c in arr {
        let start = c.get("start").and_then(Value::as_f64).unwrap_or(0.0);
        let title = c
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("")
            .replace(['\r', '\n'], " ");
        body.push_str(&format!("{} {}\n", fmt_ts(start), title.trim()));
    }

    // Stage the chapters file in the temp dir (pid-scoped so concurrent edits don't
    // collide) and remove it after tone runs.
    let chapters_path = std::env::temp_dir().join(format!("skald-chapters-{}.txt", std::process::id()));
    std::fs::write(&chapters_path, body).map_err(|e| format!("write chapters file: {e}"))?;

    let mut cmd = Command::new(&tone);
    cmd.arg("tag")
        .arg("--meta-chapters-file")
        .arg(&chapters_path)
        .arg(file);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    // Same hung-child guard as the tag path (see probe::output_with_timeout).
    let result = crate::probe::output_with_timeout(&mut cmd, std::time::Duration::from_secs(300));
    let _ = std::fs::remove_file(&chapters_path);

    match result {
        Ok(out) if out.status.success() => {
            log::info!(target: "skald::metadata", "tone wrote {} chapters to {}", arr.len(), file.display());
            Ok(())
        }
        Ok(out) => {
            let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
            log::warn!(target: "skald::metadata", "tone chapters write failed {}: {msg}", file.display());
            Err(if msg.is_empty() { "tone reported a non-zero exit".to_string() } else { msg })
        }
        Err(e) => {
            log::warn!(target: "skald::metadata", "tone spawn failed {}: {e}", file.display());
            Err(e.to_string())
        }
    }
}
