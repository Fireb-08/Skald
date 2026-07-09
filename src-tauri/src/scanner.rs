// scanner.rs — local audiobook folder scanner (Local Library roadmap, Phase 1).
//
// Walks a folder, groups audio files into "book units", reads embedded metadata
// (tags + chapters + duration) via `ffprobe` (see probe.rs), and emits **ABS-shaped
// LibraryItem JSON** so the existing frontend shelf/player can consume local
// items unchanged. The single biggest leverage point of the whole feature is
// that the frontend only cares about the JSON *shape*, not the origin — so this
// module's job is to produce that shape from files on disk.
//
// A "book unit" here is one directory that directly contains audio files; its
// files (sorted by name) are the book's tracks. A single-file book uses its
// embedded chapters; a multi-file book gets one chapter per file. Real grouping
// (Author/Series/Title inference, standalone-file handling) is the ingest layer's
// job (Phase 3) — this scanner is deliberately a thin "what's on disk" reader.
//
// Tag + chapter + duration reading is delegated to ffprobe (probe::probe_file),
// matching how Audiobookshelf reads metadata. lofty is retained only for embedded
// cover-art byte extraction (find_cover_bytes).

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

// lofty is retained only for embedded cover-art extraction (find_cover_bytes);
// all tag + chapter reading now goes through ffprobe (probe.rs).
use lofty::prelude::*;
use lofty::probe::Probe;

use crate::probe;

/// Audio extensions the scanner recognises. Mirrors the set `play_local` already
/// plays (session.rs) plus `wav`, so anything scanned is also playable.
/// pub: the server-upload folder walk (commands::resolve_upload_files) reuses it.
pub const AUDIO_EXTS: &[&str] = &["m4b", "mp3", "aac", "ogg", "flac", "opus", "m4a", "wav"];

/// Supplemental (non-audio) files worth recording on the item so the ingest layer
/// can move them alongside the book (cover art, liner notes, etc.).
/// pub: shared with the server-upload folder walk, same as AUDIO_EXTS.
pub const SUPPLEMENTAL_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "pdf", "nfo", "cue", "txt", "opf"];

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

/// Sidecar cover file names checked (in order) when looking for folder art.
const COVER_NAMES: &[&str] = &["cover.jpg", "cover.jpeg", "cover.png", "cover.webp", "folder.jpg", "folder.png"];

fn has_sidecar_cover(dir: &Path) -> bool {
    COVER_NAMES.iter().any(|n| dir.join(n).is_file())
}

/// Return raw cover bytes for a book directory: a sidecar image if present, else
/// the embedded art of the first audio file. None when neither exists. (Phase 8;
/// the caller resizes/caches.)
pub fn find_cover_bytes(dir: &Path) -> Option<Vec<u8>> {
    // 1. Sidecar image file.
    for n in COVER_NAMES {
        let p = dir.join(n);
        if p.is_file() {
            if let Ok(b) = std::fs::read(&p) {
                return Some(b);
            }
        }
    }
    // 2. Embedded art from the first audio file (alphabetical).
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| is_audio(p))
        .collect();
    files.sort();
    for f in files {
        if let Ok(tagged) = Probe::open(&f).and_then(|p| p.read()) {
            if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
                if let Some(pic) = tag.pictures().first() {
                    return Some(pic.data().to_vec());
                }
            }
        }
    }
    None
}

/// Stable id derived from the directory path. Deterministic for the same path so
/// a re-scan of an un-moved book yields the same id. The catalog (Phase 2) owns
/// long-term identity across moves; this is the pre-catalog seed (and the per-file
/// `ino` in libraryFiles).
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

    let probed: Vec<probe::ProbedFile> = files.iter().map(|f| probe::probe_file(f)).collect();
    let first = probed.first();

    // ── Resolve display fields, preferring real tags over folder guesses ───────
    let tag_title = first.and_then(|p| p.title.clone());
    let tag_author = first.and_then(|p| p.author.clone());

    let (fb_title, fb_author, fb_series) = folder_fallback(dir, root);

    let title = tag_title.clone().or(fb_title);
    let author = tag_author.clone().or(fb_author);
    // Series: prefer a tag, fall back to the folder layout.
    let series = first.and_then(|p| p.series.clone()).or(fb_series);
    let series_sequence = first.and_then(|p| p.series_sequence.clone());
    let narrator = first.and_then(|p| p.narrator.clone());
    let subtitle = first.and_then(|p| p.subtitle.clone());
    let publisher = first.and_then(|p| p.publisher.clone());
    let year = first.and_then(|p| p.year.clone());
    let language = first.and_then(|p| p.language.clone());
    let isbn = first.and_then(|p| p.isbn.clone());
    let asin = first.and_then(|p| p.asin.clone());
    let description = first.and_then(|p| p.description.clone());

    // Distinct, order-preserving genre list across all files.
    let mut genres: Vec<String> = Vec::new();
    for p in &probed {
        for g in &p.genres {
            if !genres.contains(g) {
                genres.push(g.clone());
            }
        }
    }

    let total_duration: f64 = probed.iter().map(|p| p.duration_secs).sum();

    // ── Chapters ──────────────────────────────────────────────────────────────
    // Single-file book: use its real embedded chapters (ffprobe). Multi-file book:
    // one chapter per file. Lone file without embedded chapters: none.
    let chapters: Vec<Value> = if files.len() == 1 && !probed[0].chapters.is_empty() {
        probed[0]
            .chapters
            .iter()
            .enumerate()
            .map(|(i, c)| json!({ "id": i, "start": c.start, "end": c.end, "title": c.title }))
            .collect()
    } else if files.len() > 1 {
        let mut acc = 0.0f64;
        files
            .iter()
            .zip(probed.iter())
            .enumerate()
            .map(|(i, (f, p))| {
                let start = acc;
                let end = acc + p.duration_secs;
                acc = end;
                let title = f
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("Chapter {}", i + 1));
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
    // A cover exists if any file carries embedded art OR a sidecar image sits in
    // the folder (cover.jpg from a match, etc.).
    let has_cover = probed.iter().any(|p| p.has_cover) || has_sidecar_cover(dir);

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
                "subtitle": subtitle,
                "authorName": author,
                "narratorName": narrator,
                "seriesName": series,
                "seriesSequence": series_sequence,
                "publisher": publisher,
                "publishedYear": year,
                "language": language,
                "isbn": isbn,
                "asin": asin,
                "genres": genres,
                "description": description,
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
/// contains audio files. Blocking I/O — call from `spawn_blocking`.
pub fn scan_folder(root: &str, library_id: &str) -> Result<Vec<ScannedItem>, String> {
    scan_impl(root, library_id)
}

/// Alias kept for callers that scan the Staging / Unidentified folders directly.
/// Now identical to scan_folder — the managed folders are siblings of Audiobooks,
/// so each scan simply targets the correct folder (no skip logic needed).
pub fn scan_unidentified(root: &str, library_id: &str) -> Result<Vec<ScannedItem>, String> {
    scan_impl(root, library_id)
}

fn scan_impl(root: &str, library_id: &str) -> Result<Vec<ScannedItem>, String> {
    let root_path = Path::new(root);
    if !root_path.exists() {
        // Not yet created (e.g. a freshly-made library's Audiobooks folder is
        // empty) — treat as no items rather than an error.
        return Ok(Vec::new());
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

/// Cheap presence scan: the set of book-unit directories under `root`, as absolute
/// path strings, WITHOUT probing any file. A book unit is a directory that directly
/// contains audio. The catalog reconcile uses this to diff disk against the catalog
/// so it never pays an ffprobe spawn per file for books it already knows — only
/// genuinely-new directories get probed (via `scan_dir`). Blocking I/O.
pub fn list_book_dirs(root: &str) -> Result<Vec<String>, String> {
    let root_path = Path::new(root);
    if !root_path.exists() {
        return Ok(Vec::new());
    }
    // BTreeSet de-duplicates parents (many files share one) and keeps a stable order.
    let mut dirs: std::collections::BTreeSet<PathBuf> = std::collections::BTreeSet::new();
    for entry in WalkDir::new(root_path).into_iter().filter_map(|e| e.ok()) {
        let p = entry.path();
        if p.is_file() && is_audio(p) {
            if let Some(parent) = p.parent() {
                dirs.insert(parent.to_path_buf());
            }
        }
    }
    Ok(dirs.into_iter().map(|d| d.to_string_lossy().into_owned()).collect())
}

/// Build one ScannedItem for a single newly-discovered book-unit directory,
/// probing ONLY this directory's audio files. Used by the reconcile to catalogue a
/// new book without re-probing the whole library. `root` is the library's
/// Audiobooks root (used for the folder-name fallback). None if it holds no audio.
pub fn scan_dir(dir: &str, root: &str, library_id: &str) -> Option<ScannedItem> {
    let dir_path = Path::new(dir);
    let files: Vec<PathBuf> = std::fs::read_dir(dir_path)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| is_audio(p))
        .collect();
    if files.is_empty() {
        return None;
    }
    Some(build_item(dir_path, Path::new(root), files, library_id))
}
