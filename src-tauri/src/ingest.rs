// ingest.rs — file-system organize layer (Local Library roadmap, Phase 3).
//
// Takes a scanned book unit and places it into the managed library tree as
// `<root>/Author/[Series/]Title/`, or — when it can't be identified confidently
// — into `<root>/_Unidentified/<name>/` for the later match flow (Phase 5). This
// module owns only the *placement* (path building, sanitization, copy/move with
// verify-before-delete, collision handling); the decision of where a book goes
// and the catalog rebuild live in catalog.rs.
//
// Safety posture (study §5 #2/#9): copy is the default (originals survive), and
// a cross-volume move copies → verifies size → only then deletes the source.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Windows reserved device names — a path component equal to one of these
/// (case-insensitive, ignoring extension) is invalid, so we prefix it.
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// The outcome of attempting to ingest one book unit. Serialized to the frontend
/// so the import UI can summarize filed vs. quarantined vs. errored.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestOutcome {
    pub title: String,
    /// "filed" | "quarantined" | "error".
    pub outcome: String,
    /// Absolute destination directory (empty on error).
    pub target_path: String,
    /// Error detail when outcome == "error".
    pub message: String,
}

/// Make one path component safe for Windows: replace reserved chars and control
/// codes, trim trailing dots/spaces, avoid reserved device names, and cap length.
pub fn sanitize_component(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();

    // Windows forbids trailing dots/spaces on a path component.
    let trimmed = s.trim_matches(|c| c == ' ' || c == '.').to_string();
    s = if trimmed.is_empty() { "_".to_string() } else { trimmed };

    // Reserved device name (compare the stem, case-insensitive).
    let stem = s.split('.').next().unwrap_or(&s).to_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        s = format!("_{s}");
    }

    // Cap per-component length to keep the full path well under MAX_PATH; deep
    // Author/Series/Title nesting is the reason this is conservative.
    if s.chars().count() > 120 {
        s = s.chars().take(120).collect();
    }
    s
}

/// Build the managed destination directory `<root>/Author/[Series/]Title`.
pub fn book_target_dir(root: &Path, author: &str, series: Option<&str>, title: &str) -> PathBuf {
    let mut p = root.join(sanitize_component(author));
    if let Some(s) = series {
        if !s.trim().is_empty() {
            p = p.join(sanitize_component(s));
        }
    }
    p.join(sanitize_component(title))
}

/// If `target` already exists, append " (2)", " (3)", … until a free path is
/// found, so an ingest never clobbers an existing book folder.
pub fn unique_dir(target: PathBuf) -> PathBuf {
    if !target.exists() {
        return target;
    }
    let parent = match target.parent() {
        Some(p) => p.to_path_buf(),
        None => return target,
    };
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("book")
        .to_string();
    for n in 2..1000 {
        let cand = parent.join(format!("{name} ({n})"));
        if !cand.exists() {
            return cand;
        }
    }
    target
}

/// Recursively remove empty subdirectories of `root` (depth-first), leaving
/// `root` itself in place. Used to clean up the folder skeletons left behind in
/// Staging after a move-based distribution (files get moved out; the now-empty
/// `Author/Book/…` folders should not linger).
pub fn prune_empty_dirs(root: &Path) {
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let p = entry.path();
        if p.is_dir() {
            // Prune children first, then remove this dir if it became empty.
            prune_empty_dirs(&p);
            let now_empty = std::fs::read_dir(&p)
                .map(|mut it| it.next().is_none())
                .unwrap_or(false);
            if now_empty {
                let _ = std::fs::remove_dir(&p);
            }
        }
    }
}

/// Delete `path` only if the copy that preceded this call wrote exactly as many
/// bytes as the source holds; on mismatch the source is left untouched and an
/// error is returned. Factored out of `place_book`'s move fallback so the
/// verify-failure branch is directly testable — a same-volume tempdir test
/// cannot force `rename` to fail, but it can call this with a wrong length.
fn verify_then_delete(path: &Path, copied: u64) -> Result<(), String> {
    let src_len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(u64::MAX);
    if copied == src_len {
        let _ = std::fs::remove_file(path);
        Ok(())
    } else {
        Err(format!(
            "verify failed: copied {copied} bytes != source {src_len} for {}",
            path.display()
        ))
    }
}

/// Move or copy the **direct files** of `source_dir` (audio + supplemental; not
/// subdirectories, which are separate book units) into `target_dir`.
///
/// `move_files`: when true, prefer an atomic same-volume rename; on a
/// cross-volume rename failure, copy → verify byte length → delete the source.
/// When false (copy mode), the source is left untouched.
pub fn place_book(source_dir: &Path, target_dir: &Path, move_files: bool) -> Result<(), String> {
    std::fs::create_dir_all(target_dir).map_err(|e| format!("create target dir: {e}"))?;

    for entry in std::fs::read_dir(source_dir).map_err(|e| format!("read source dir: {e}"))? {
        let entry = entry.map_err(|e| format!("read entry: {e}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue; // subfolders are separate book units; never recurse here
        }
        let dest = target_dir.join(entry.file_name());

        if move_files {
            // Fast path: same-volume rename is atomic.
            if std::fs::rename(&path, &dest).is_err() {
                // Cross-volume (or locked) — copy, verify, then delete.
                let copied = std::fs::copy(&path, &dest).map_err(|e| format!("copy (move fallback): {e}"))?;
                verify_then_delete(&path, copied)?;
            }
        } else {
            std::fs::copy(&path, &dest).map_err(|e| format!("copy: {e}"))?;
        }
    }
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────
// File-safety regression tests (review H3): this module moves/copies the user's
// audio and deletes sources after verification, so every branch that can lose a
// file is pinned here. Everything runs against tempfile dirs — never real data.
#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    }

    // ── sanitize_component ────────────────────────────────────────────────────

    #[test]
    fn sanitize_replaces_reserved_chars_and_control_codes() {
        assert_eq!(sanitize_component(r#"a<b>c:d"e/f\g|h?i*j"#), "a_b_c_d_e_f_g_h_i_j");
        assert_eq!(sanitize_component("tab\there"), "tab_here");
    }

    #[test]
    fn sanitize_trims_trailing_dots_and_spaces() {
        // Windows silently strips trailing dots/spaces at the API level, so a
        // component keeping them would point at a different real path.
        assert_eq!(sanitize_component("Title..."), "Title");
        assert_eq!(sanitize_component("Title  "), "Title");
        assert_eq!(sanitize_component("..."), "_", "all-dot name must not collapse to empty");
        assert_eq!(sanitize_component(""), "_");
    }

    #[test]
    fn sanitize_prefixes_reserved_device_names() {
        assert_eq!(sanitize_component("CON"), "_CON");
        assert_eq!(sanitize_component("con"), "_con", "reserved check is case-insensitive");
        assert_eq!(sanitize_component("COM1.mp3"), "_COM1.mp3", "extension does not un-reserve the stem");
        assert_eq!(sanitize_component("Console"), "Console", "prefix-only matches are fine");
    }

    #[test]
    fn sanitize_caps_component_length_at_120() {
        let long = "x".repeat(300);
        assert_eq!(sanitize_component(&long).chars().count(), 120);
    }

    // ── book_target_dir ───────────────────────────────────────────────────────

    #[test]
    fn target_dir_includes_series_only_when_present() {
        let root = Path::new("root");
        assert_eq!(
            book_target_dir(root, "Author", Some("Series"), "Title"),
            root.join("Author").join("Series").join("Title"),
        );
        assert_eq!(
            book_target_dir(root, "Author", None, "Title"),
            root.join("Author").join("Title"),
        );
        // Whitespace-only series must not create an empty path level.
        assert_eq!(
            book_target_dir(root, "Author", Some("   "), "Title"),
            root.join("Author").join("Title"),
        );
        // Components are sanitized on the way in (reserved chars become '_').
        assert_eq!(
            book_target_dir(root, "A:B", None, "T?"),
            root.join("A_B").join("T_"),
        );
    }

    // ── unique_dir ────────────────────────────────────────────────────────────

    #[test]
    fn unique_dir_suffixes_on_collision() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("Book");

        // Free path comes back untouched.
        assert_eq!(unique_dir(target.clone()), target);

        // First collision → " (2)", then " (3)" once that exists too.
        std::fs::create_dir_all(&target).unwrap();
        assert_eq!(unique_dir(target.clone()), dir.path().join("Book (2)"));
        std::fs::create_dir_all(dir.path().join("Book (2)")).unwrap();
        assert_eq!(unique_dir(target.clone()), dir.path().join("Book (3)"));
    }

    // ── place_book ────────────────────────────────────────────────────────────

    #[test]
    fn place_book_copy_leaves_source_and_skips_subdirs() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        write(src.path(), "book.m4b", b"audio");
        write(src.path(), "cover.jpg", b"img");
        // A subdirectory is a separate book unit — it must never be recursed into.
        std::fs::create_dir(src.path().join("Sequel")).unwrap();
        write(&src.path().join("Sequel"), "other.m4b", b"other");

        let target = dst.path().join("Author").join("Title");
        place_book(src.path(), &target, false).unwrap();

        assert!(target.join("book.m4b").exists());
        assert!(target.join("cover.jpg").exists());
        assert!(!target.join("Sequel").exists(), "subdirs are not placed");
        assert!(src.path().join("book.m4b").exists(), "copy mode leaves the source intact");
        assert_eq!(std::fs::read(target.join("book.m4b")).unwrap(), b"audio");
    }

    #[test]
    fn place_book_move_relocates_files() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        write(src.path(), "book.m4b", b"audio");

        let target = dst.path().join("Title");
        place_book(src.path(), &target, true).unwrap();

        assert!(target.join("book.m4b").exists());
        assert!(!src.path().join("book.m4b").exists(), "move mode removes the source file");
    }

    // ── verify_then_delete (the branch that guards source deletion) ───────────

    #[test]
    fn verify_mismatch_preserves_source() {
        let dir = tempfile::tempdir().unwrap();
        let src = write(dir.path(), "book.m4b", b"0123456789"); // 10 bytes

        // A short copy must fail AND leave the source on disk.
        let err = verify_then_delete(&src, 5).unwrap_err();
        assert!(err.contains("verify failed"), "unexpected error: {err}");
        assert!(src.exists(), "source must survive a failed verification");
    }

    #[test]
    fn verify_match_deletes_source() {
        let dir = tempfile::tempdir().unwrap();
        let src = write(dir.path(), "book.m4b", b"0123456789");

        verify_then_delete(&src, 10).unwrap();
        assert!(!src.exists(), "verified move deletes the source");
    }

    // ── prune_empty_dirs ──────────────────────────────────────────────────────

    #[test]
    fn prune_removes_nested_empty_dirs_but_keeps_root_and_content() {
        let dir = tempfile::tempdir().unwrap();
        // Empty skeleton left behind after a move-based distribution…
        std::fs::create_dir_all(dir.path().join("Author").join("Book")).unwrap();
        // …next to a folder that still holds a file.
        std::fs::create_dir_all(dir.path().join("Keep")).unwrap();
        write(&dir.path().join("Keep"), "file.m4b", b"x");

        prune_empty_dirs(dir.path());

        assert!(!dir.path().join("Author").exists(), "empty skeleton pruned depth-first");
        assert!(dir.path().join("Keep").join("file.m4b").exists(), "non-empty dirs survive");
        assert!(dir.path().exists(), "root itself is never removed");
    }
}
