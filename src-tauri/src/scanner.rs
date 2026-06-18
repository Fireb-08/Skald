// scanner.rs — local audiobook folder scanner (Local Library roadmap, Phase 1).
//
// Walks a folder, groups audio files into "book units", reads embedded metadata
// (tags + cover presence + duration) via `lofty`, and emits **ABS-shaped
// LibraryItem JSON** so the existing frontend shelf/player can consume local
// items unchanged. The single biggest leverage point of the whole feature is
// that the frontend only cares about the JSON *shape*, not the origin — so this
// module's job is to produce that shape from files on disk.
//
// A "book unit" here is one directory that directly contains audio files; its
// files (sorted by name) are the book's tracks. Multi-file books become one item
// with one chapter per file; a lone file is a single-track book. Real grouping
// (Author/Series/Title inference, standalone-file handling) is the ingest layer's
// job (Phase 3) — this scanner is deliberately a thin "what's on disk" reader.
//
// Duration comes from lofty's parsed audio properties. Symphonia is reserved as
// a fallback for formats where lofty reports a zero duration (wired in a later
// phase only if a real gap shows up — see roadmap §"things to confirm").
//
// NOTE (per CLAUDE.md): exact lofty API surface can shift across versions; if a
// method name differs at build time, that is the expected spike outcome — adjust
// against the resolved lofty version rather than guessing further here.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use lofty::prelude::*;
use lofty::probe::Probe;

/// Audio extensions the scanner recognises. Mirrors the set `play_local` already
/// plays (session.rs) plus `wav`, so anything scanned is also playable.
const AUDIO_EXTS: &[&str] = &["m4b", "mp3", "aac", "ogg", "flac", "opus", "m4a", "wav"];

/// Supplemental (non-audio) files worth recording on the item so the ingest layer
/// can move them alongside the book (cover art, liner notes, etc.).
const SUPPLEMENTAL_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "pdf", "nfo", "cue", "txt", "opf"];

fn ext_lower(path: &Path) -> Option<String> {
    path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase())
}

fn is_audio(path: &Path) -> bool {
    ext_lower(path).map(|e| AUDIO_EXTS.contains(&e.as_str())).unwrap_or(false)
}

fn is_supplemental(path: &Path) -> bool {
    ext_lower(path).map(|e| SUPPLEMENTAL_EXTS.contains(&e.as_str())).unwrap_or(false)
}

/// A scanned book unit: the emitted ABS-shaped item plus scanner-only context the
/// ingest/UI layers need (where it lives on disk, and how confident the read was).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedItem {
    /// ABS-shaped LibraryItem JSON — consumed by the existing frontend verbatim.
    pub item: Value,
    /// Absolute path of the book unit's directory (the playback source for
    /// `play_local_file`, and the move source for ingest).
    pub source_path: String,
    /// 0..=100 — how much of title/author/series came from real tags vs. guesses.
    pub confidence: u8,
    /// True when both a title and an author were resolved (from tags or folders).
    pub identified: bool,
}

/// Tags read from a single audio file.
#[derive(Default)]
struct TrackTags {
    title: Option<String>,
    artist: Option<String>,       // maps to author
    album: Option<String>,        // usually the book title
    album_artist: Option<String>, // preferred author when present
    narrator: Option<String>,     // best-effort (composer/narrator tags vary)
    genre: Option<String>,
    duration_secs: f64,
    has_cover: bool,
}

/// Read embedded tags + duration from one audio file. Never fails: an unreadable
/// file yields empty tags (it still counts as a track, just without metadata).
fn read_track_tags(path: &Path) -> TrackTags {
    let mut t = TrackTags::default();
    match Probe::open(path).and_then(|p| p.read()) {
        Ok(tagged) => {
            t.duration_secs = tagged.properties().duration().as_secs_f64();
            if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
                t.title = tag.title().map(|s| s.to_string());
                t.artist = tag.artist().map(|s| s.to_string());
                t.album = tag.album().map(|s| s.to_string());
                t.genre = tag.genre().map(|s| s.to_string());
                t.has_cover = !tag.pictures().is_empty();
                t.album_artist = tag.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string());
                // Narrator has no universal tag; composer is the most common
                // convention for audiobooks. Refined in a later phase if needed.
                t.narrator = tag.get_string(&ItemKey::Composer).map(|s| s.to_string());
            }
        }
        Err(e) => {
            log::warn!(target: "skald::library", "scan: unreadable audio file {} ({e})", path.display());
        }
    }
    t
}

/// Stable id derived from the directory path. Deterministic for the same path so
/// a re-scan of an un-moved book yields the same id. The catalog (Phase 2) owns
/// long-term identity across moves; this is the pre-catalog seed.
fn stable_id(path: &Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.to_string_lossy().hash(&mut h);
    format!("local_{:016x}", h.finish())
}

/// Light folder-name fallback when tags are missing. For `<root>/A/B/Title` we
/// treat the title folder as the book and its parent as the author — the common
/// `Author/Title` (and a best-effort at `Author/Series/Title`) layout. This is a
/// heuristic; the ingest layer (Phase 3) does the authoritative parsing.
fn folder_fallback(dir: &Path, root: &Path) -> (Option<String>, Option<String>, Option<String>) {
    let rel = dir.strip_prefix(root).unwrap_or(dir);
    let parts: Vec<String> = rel
        .components()
        .filter_map(|c| c.as_os_str().to_str().map(|s| s.to_string()))
        .collect();
    match parts.as_slice() {
        // Author / Series / Title
        [author, series, title, ..] => (Some(title.clone()), Some(author.clone()), Some(series.clone())),
        // Author / Title
        [author, title] => (Some(title.clone()), Some(author.clone()), None),
        // Just a title folder
        [title] => (Some(title.clone()), None, None),
        _ => (None, None, None),
    }
}

/// Build one ABS-shaped item from a directory of audio files.
fn build_item(dir: &Path, root: &Path, mut files: Vec<PathBuf>, library_id: &str) -> ScannedItem {
    files.sort(); // alphabetical = chapter order (matches play_local's behaviour)

    let tracks: Vec<TrackTags> = files.iter().map(|f| read_track_tags(f)).collect();
    let first = tracks.first();

    // ── Resolve display fields, preferring real tags over folder guesses ───────
    let tag_title = first.and_then(|t| t.album.clone()).filter(|s| !s.trim().is_empty());
    let tag_author = first
        .and_then(|t| t.album_artist.clone().or_else(|| t.artist.clone()))
        .filter(|s| !s.trim().is_empty());

    let (fb_title, fb_author, fb_series) = folder_fallback(dir, root);

    let title = tag_title.clone().or(fb_title);
    let author = tag_author.clone().or(fb_author);
    let series = fb_series; // series has no standard single-file tag; folder-derived for now
    let narrator = first.and_then(|t| t.narrator.clone());

    // Distinct, order-preserving genre list across all tracks.
    let mut genres: Vec<String> = Vec::new();
    for tr in &tracks {
        if let Some(g) = &tr.genre {
            if !g.trim().is_empty() && !genres.contains(g) {
                genres.push(g.clone());
            }
        }
    }

    let total_duration: f64 = tracks.iter().map(|t| t.duration_secs).sum();

    // ── Chapters: one per file for multi-file books; none for single-file ──────
    // (Embedded single-file chapter atoms are a later-phase enhancement.)
    let chapters: Vec<Value> = if files.len() > 1 {
        let mut acc = 0.0f64;
        files
            .iter()
            .zip(tracks.iter())
            .enumerate()
            .map(|(i, (f, tr))| {
                let start = acc;
                let end = acc + tr.duration_secs;
                acc = end;
                let title = tr.title.clone().unwrap_or_else(|| {
                    f.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string())
                        .unwrap_or_else(|| format!("Chapter {}", i + 1))
                });
                json!({ "id": i, "start": start, "end": end, "title": title })
            })
            .collect()
    } else {
        Vec::new()
    };

    // ── library_files block (ABS LibraryFile shape) ───────────────────────────
    let library_files: Vec<Value> = files
        .iter()
        .map(|f| {
            let size = std::fs::metadata(f).map(|m| m.len() as i64).unwrap_or(0);
            let filename = f.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
            json!({
                "ino": stable_id(f),
                "metadata": { "filename": filename, "size": size, "path": f.to_string_lossy() },
                "fileType": "audio",
            })
        })
        .collect();

    let id = stable_id(dir);
    let has_cover = tracks.iter().any(|t| t.has_cover);

    // ── Confidence: title/author dominate; series is a bonus ───────────────────
    let mut confidence: u8 = 0;
    if tag_title.is_some() { confidence = confidence.saturating_add(40); }
    else if title.is_some() { confidence = confidence.saturating_add(15); } // folder-only
    if tag_author.is_some() { confidence = confidence.saturating_add(40); }
    else if author.is_some() { confidence = confidence.saturating_add(15); }
    if series.is_some() { confidence = confidence.saturating_add(20); }
    let confidence = confidence.min(100);

    let identified = title.is_some() && author.is_some();

    // ABS-shaped LibraryItem. `media.metadata` keys match what the frontend reads
    // (bookTitle/bookAuthor/bookNarrator/bookSeries/bookGenres/bookDurSecs). The
    // `genres` array is always present because bookGenre() indexes genres[0]
    // without a guard. `localPath` is a Skald-only convenience the local play
    // path uses; ABS items never carry it.
    let item = json!({
        "id": id,
        "ino": id,
        "libraryId": library_id,
        "mediaType": "book",
        "localPath": dir.to_string_lossy(),
        "hasLocalCover": has_cover,
        "media": {
            "duration": total_duration,
            "chapters": chapters,
            "metadata": {
                "title": title,
                "authorName": author,
                "narratorName": narrator,
                "seriesName": series,
                "genres": genres,
                "publisher": Value::Null,
            },
        },
        "libraryFiles": library_files,
    });

    ScannedItem {
        item,
        source_path: dir.to_string_lossy().into_owned(),
        confidence,
        identified,
    }
}

/// Scan `root` recursively and return one ScannedItem per directory that directly
/// contains audio files, **skipping the `_Unidentified` quarantine folder**.
/// Blocking I/O — call from `spawn_blocking`.
pub fn scan_folder(root: &str, library_id: &str) -> Result<Vec<ScannedItem>, String> {
    scan_impl(root, library_id, true)
}

/// Scan the quarantine folder itself (does NOT skip `_Unidentified`). Used to
/// list books awaiting a metadata match (Phase 5).
pub fn scan_unidentified(root: &str, library_id: &str) -> Result<Vec<ScannedItem>, String> {
    scan_impl(root, library_id, false)
}

fn scan_impl(root: &str, library_id: &str, skip_unidentified: bool) -> Result<Vec<ScannedItem>, String> {
    let root_path = Path::new(root);
    if !root_path.exists() {
        return Err(format!("Scan path does not exist: {root}"));
    }
    log::info!(target: "skald::library", "scan: start path={root}");

    // Group audio files by their immediate parent directory. A directory that
    // directly holds audio files is one book unit; its subfolders are scanned too
    // and become their own units if they hold audio.
    let mut by_dir: BTreeMap<PathBuf, Vec<PathBuf>> = BTreeMap::new();
    let mut supplemental = 0usize;
    for entry in WalkDir::new(root_path).into_iter().filter_map(|e| e.ok()) {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        // Skip the quarantine folder — unidentified books awaiting a match
        // (ingest.rs) live under `_Unidentified/` and must not surface on the shelf.
        // Disabled when scanning the quarantine folder itself (scan_unidentified).
        if skip_unidentified && p.components().any(|c| c.as_os_str() == "_Unidentified") {
            continue;
        }
        if is_audio(p) {
            if let Some(parent) = p.parent() {
                by_dir.entry(parent.to_path_buf()).or_default().push(p.to_path_buf());
            }
        } else if is_supplemental(p) {
            supplemental += 1;
        }
    }

    let items: Vec<ScannedItem> = by_dir
        .into_iter()
        .map(|(dir, files)| build_item(&dir, root_path, files, library_id))
        .collect();

    let identified = items.iter().filter(|i| i.identified).count();
    log::info!(
        target: "skald::library",
        "scan: done items={} identified={} supplemental_files={}",
        items.len(), identified, supplemental
    );
    Ok(items)
}
