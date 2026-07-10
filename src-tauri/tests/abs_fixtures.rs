// ABS response-shape contract tests (review L4). Each fixture under
// tests/fixtures/abs/ mirrors a real Audiobookshelf response shape, verified
// against the ABS server source (provenance noted per test). If a server
// upgrade drifts a shape our serde models depend on, these fail with a named
// fixture instead of a runtime deserialization error mid-session.
//
// The fixtures deliberately carry MORE fields than the models capture — extra
// keys must always be ignored, mirroring how a newer ABS talks to Skald.

use serde::Deserialize;
use skald_lib::models::{Library, LibraryItem, MeResponse, PlaySession, ServerSettings, User};

fn json<T: serde::de::DeserializeOwned>(raw: &str, what: &str) -> T {
    serde_json::from_str(raw).unwrap_or_else(|e| panic!("{what} fixture failed to parse: {e}"))
}

// GET /api/items/{id}?expanded=1 — LibraryItem.toJSONExpanded()
// (server/objects/LibraryItem.js): authors/series as object arrays, audioFiles,
// chapters, libraryFiles.
#[test]
fn expanded_book_item_parses_and_media_passes_through() {
    let item: LibraryItem = json(include_str!("fixtures/abs/book_item_expanded.json"), "expanded book");
    assert_eq!(item.id, "li_abc123");
    assert_eq!(item.library_id, "lib_books");
    assert_eq!(item.media_type, "book");
    assert_eq!(item.library_files.as_ref().map(|f| f.len()), Some(1));
    assert_eq!(item.library_files.as_ref().unwrap()[0].metadata.filename, "The Red Knight.m4b");

    // media is pass-through Value — the frontend narrows it, so the object
    // shapes must survive a round-trip untouched (author objects, series
    // sequence, chapters).
    let back = serde_json::to_value(&item).expect("round-trip serialize");
    assert_eq!(back["media"]["metadata"]["authors"][0]["name"], "Miles Cameron");
    assert_eq!(back["media"]["metadata"]["series"][0]["sequence"], "1");
    assert_eq!(back["media"]["chapters"][1]["title"], "The Inn at Harndon");
}

// GET /api/libraries/{id}/items results — LibraryItem.toJSONMinified():
// metadata carries flat authorName/seriesName strings instead of object
// arrays, and older payloads may omit mediaType entirely (defaulted to book).
#[test]
fn minified_book_item_defaults_media_type_and_keeps_flat_author() {
    let item: LibraryItem = json(include_str!("fixtures/abs/book_item_minified.json"), "minified book");
    assert_eq!(item.media_type, "book", "omitted mediaType must default to book");
    assert!(item.library_files.is_none(), "minified items carry no libraryFiles");

    let back = serde_json::to_value(&item).expect("round-trip serialize");
    // The flat string author form (vs the expanded object array) is exactly the
    // shape variance CLAUDE.md critical lesson 5 warns about — pin both.
    assert_eq!(back["media"]["metadata"]["authorName"], "Michael R. Fletcher");
    assert_eq!(back["media"]["metadata"]["seriesName"], "");
}

// Podcast library item — Podcast.toJSONExpanded() with episodes[] inside media
// (server/objects/mediaTypes/Podcast.js). episodes must survive pass-through:
// a typed BookMedia here would silently drop them (see models.rs LibraryItem).
#[test]
fn podcast_item_keeps_episodes_through_round_trip() {
    let item: LibraryItem = json(include_str!("fixtures/abs/podcast_item.json"), "podcast item");
    assert_eq!(item.media_type, "podcast");

    let back = serde_json::to_value(&item).expect("round-trip serialize");
    assert_eq!(back["media"]["episodes"][0]["id"], "ep_1");
    assert_eq!(back["media"]["episodes"][0]["audioTrack"]["contentUrl"], "/api/items/li_pod1/file/778");
    assert_eq!(back["media"]["metadata"]["feedUrl"], "https://feeds.feedburner.com/dancarlin/history");
}

// GET /api/me — User.toOldJSONForBrowser() (server/objects/user/User.js):
// mediaProgress records (book + per-episode), bookmarks, type, permissions.
#[test]
fn me_response_parses_progress_bookmarks_and_permissions() {
    let me: MeResponse = json(include_str!("fixtures/abs/me_response.json"), "/api/me");
    assert_eq!(me.id, "usr_1");
    assert_eq!(me.user_type.as_deref(), Some("user"));

    assert_eq!(me.media_progress.len(), 2);
    let book = &me.media_progress[0];
    assert_eq!(book.library_item_id, "li_abc123");
    assert_eq!(book.episode_id, None);
    assert!((book.current_time - 26581.9).abs() < f64::EPSILON);
    assert!(!book.is_finished);
    let episode = &me.media_progress[1];
    assert_eq!(episode.episode_id.as_deref(), Some("ep_1"));
    assert!(episode.is_finished);

    assert_eq!(me.bookmarks.len(), 1);
    assert_eq!(me.bookmarks[0].library_item_id, "li_abc123");
    // The upload permission gates the shelf Upload button — a rename here
    // would silently hide the feature.
    assert!(me.permissions.as_ref().is_some_and(|p| p.upload));
}

// POST /login (server root, NOT under /api/ — CLAUDE.md critical lesson 1):
// { user, userDefaultLibraryId, serverSettings }. backupSchedule is the tricky
// field — a cron STRING when enabled but boolean false when disabled, which is
// why the model keeps it as Value.
#[test]
fn login_response_parses_user_and_server_settings() {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LoginResponse {
        user: User,
        #[serde(default)]
        user_default_library_id: Option<String>,
        #[serde(default)]
        server_settings: Option<ServerSettings>,
    }
    let login: LoginResponse = json(include_str!("fixtures/abs/login_response.json"), "/login");
    assert_eq!(login.user.username, "sam");
    assert_eq!(login.user.user_type.as_deref(), Some("root"));
    assert!(!login.user.token.is_empty());
    assert_eq!(login.user_default_library_id.as_deref(), Some("lib_books"));

    let ss = login.server_settings.expect("serverSettings present in login payload");
    assert_eq!(ss.sorting_ignore_prefix, Some(true));
    assert_eq!(ss.sorting_prefixes.as_deref(), Some(&["the".to_string(), "a".to_string()][..]));
    assert_eq!(ss.backup_schedule, Some(serde_json::Value::Bool(false)), "disabled schedule is boolean false");
}

// POST /api/items/{id}/play — PlaybackSession.toJSONForClient()
// (server/objects/PlaybackSession.js): session id + currentTime drive resume,
// audioTracks drive the LibVLC load (multi-track books chain on startOffset).
#[test]
fn play_session_parses_resume_position_and_tracks() {
    let session: PlaySession = json(include_str!("fixtures/abs/play_session.json"), "play session");
    assert_eq!(session.id, "play_sess1");
    assert!((session.current_time - 26581.9).abs() < f64::EPSILON);
    assert_eq!(session.audio_tracks.len(), 1);
    let track = &session.audio_tracks[0];
    assert_eq!(track.content_url, "/api/items/li_abc123/file/9462852");
    assert!((track.duration - 63290.25).abs() < f64::EPSILON);
}

// GET /api/libraries — { libraries: [...] } (server/controllers/LibraryController
// findAll). The second entry is deliberately minimal (folders without ids, no
// settings) to pin the #[serde(default)] coverage for sparse payloads.
#[test]
fn libraries_response_parses_full_and_minimal_entries() {
    #[derive(Deserialize)]
    struct LibrariesResponse {
        libraries: Vec<Library>,
    }
    let resp: LibrariesResponse = json(include_str!("fixtures/abs/libraries_response.json"), "/api/libraries");
    assert_eq!(resp.libraries.len(), 2);

    let books = &resp.libraries[0];
    assert_eq!(books.media_type, "book");
    assert_eq!(books.folders[0].full_path, "/audiobooks");
    assert_eq!(books.settings.as_ref().and_then(|s| s.cover_aspect_ratio), Some(1));

    let pods = &resp.libraries[1];
    assert_eq!(pods.media_type, "podcast");
    assert!(pods.settings.is_none());
    assert_eq!(pods.folders[0].full_path, "/podcasts");
    assert!(pods.folders[0].id.is_none(), "sparse folder entries parse without ids");
}
