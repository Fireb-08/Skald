// podcast_feed.rs — server-free RSS/Atom feed parsing + OPML for local podcasts.
// (Local Podcasts roadmap, Phase 1.)
//
// There is no ABS server in this feature, so Skald fetches and parses podcast
// feeds itself. The emitted JSON matches what ABS's `server/utils/podcastUtils.js`
// produces (channel → PodcastMetadata, item → PodcastEpisode) so the existing
// podcast frontend renders it unchanged and a tree Skald builds round-trips if the
// same root is later pointed at an ABS server.
//
// We parse with quick-xml's event API rather than a higher-level feed crate so we
// have full control over the iTunes (`itunes:*`), `podcast:`, `media:` and
// `content:encoded` namespaced tags ABS reads — these are the riskiest part of the
// mapping and a struct-mapping crate hides them.

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde_json::{json, Map, Value};

use crate::providers;

/// Hard cap on a feed body — the URL is arbitrary user/OPML input, so an
/// unbounded `text()` read would let a hostile or misconfigured endpoint buffer
/// arbitrary data into memory. Generous: decade-old feeds run single-digit MB.
const MAX_FEED_BYTES: usize = 20 * 1024 * 1024;

/// Fetch a feed's XML text over HTTP. Kept tiny + dependency-light (reqwest is
/// already in the graph) so the parser can be unit-reasoned without the network.
pub async fn fetch_feed_text(url: &str) -> Result<String, String> {
    use futures_util::StreamExt;
    log::info!(target: "skald::metadata", "podcast feed fetch url={url}");
    let client = reqwest::Client::builder()
        .user_agent("Skald/0.1 (local podcasts)")
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client.get(url).send().await.map_err(|e| format!("feed request: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("feed HTTP {}", resp.status()));
    }
    // Stream with a byte cap instead of resp.text()'s unbounded buffer.
    let mut body: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("feed body: {e}"))?;
        if body.len() + chunk.len() > MAX_FEED_BYTES {
            log::warn!(target: "skald::metadata", "podcast feed exceeds {} MB cap url={url}", MAX_FEED_BYTES / (1024 * 1024));
            return Err(format!("feed exceeds the {} MB size limit", MAX_FEED_BYTES / (1024 * 1024)));
        }
        body.extend_from_slice(&chunk);
    }
    // Feeds are near-universally UTF-8; lossy conversion keeps a stray byte from
    // failing the whole subscribe (quick-xml re-checks the declared encoding).
    Ok(String::from_utf8_lossy(&body).into_owned())
}

/// Read an element attribute by (unprefixed) key, unescaping entities.
fn attr(e: &BytesStart, key: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == key)
        .and_then(|a| a.unescape_value().ok().map(|c| c.into_owned()))
}

/// Convert an `itunes:duration` value to whole seconds. Accepts plain seconds
/// ("3600", "3600.5"), "MM:SS", or "HH:MM:SS" — exactly ABS's `timestampToSeconds`.
fn timestamp_to_seconds(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let parts: Vec<&str> = s.split(':').collect();
    let nums: Option<Vec<f64>> = parts.iter().map(|p| p.trim().parse::<f64>().ok()).collect();
    let nums = nums?;
    match nums.as_slice() {
        [sec] => Some(*sec),
        [m, sec] => Some(m * 60.0 + sec),
        [h, m, sec] => Some(h * 3600.0 + m * 60.0 + sec),
        _ => None,
    }
}

/// Parse an RSS `pubDate` (RFC 2822) — falling back to RFC 3339 — to Unix ms.
fn pubdate_to_ms(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    chrono::DateTime::parse_from_rfc2822(s)
        .or_else(|_| chrono::DateTime::parse_from_rfc3339(s))
        .ok()
        .map(|d| d.timestamp_millis())
}

/// Set a string field on a JSON object only when non-empty (keeps the output lean
/// and avoids emitting empty strings the frontend would have to guard against).
fn set_str(obj: &mut Map<String, Value>, key: &str, val: &str) {
    let v = val.trim();
    if !v.is_empty() {
        obj.insert(key.into(), Value::String(v.to_string()));
    }
}

/// Parse a feed's XML into ABS-shaped `{ metadata, episodes }` JSON. `feed_url` is
/// used as the `feedUrl` fallback when the feed declares neither `itunes:new-feed-url`
/// nor an `atom:link rel="self"`.
pub fn parse_feed(xml: &str, feed_url: &str) -> Result<Value, String> {
    let mut reader = Reader::from_str(xml);
    let mut buf: Vec<u8> = Vec::new();

    let mut channel = Map::new();
    let mut episodes: Vec<Value> = Vec::new();
    let mut categories: Vec<String> = Vec::new();

    // Per-item accumulators.
    let mut in_item = false;
    let mut item = Map::new();
    let mut item_has_content_encoded = false;

    // Element stack of fully-qualified names so leaf text can be routed by parent
    // (e.g. <image><url> at channel level vs an <item><title>).
    let mut stack: Vec<Vec<u8>> = Vec::new();
    let mut text = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Err(e) => return Err(format!("xml parse at {}: {e}", reader.buffer_position())),
            Ok(Event::Eof) => break,

            // Self-closing elements (attribute-only): enclosure, itunes:image,
            // atom:link, media:content, podcast:chapters, itunes:category.
            Ok(Event::Empty(e)) => {
                handle_empty(&e, in_item, &mut item, &mut channel, &mut categories, feed_url);
            }

            Ok(Event::Start(e)) => {
                let name = e.name().as_ref().to_vec();
                // Capture attributes for elements that *also* may carry text but
                // whose attributes we need (atom:link, media:content, enclosure).
                handle_empty(&e, in_item, &mut item, &mut channel, &mut categories, feed_url);
                if name == b"item" || name == b"entry" {
                    in_item = true;
                    item = Map::new();
                    item_has_content_encoded = false;
                }
                stack.push(name);
                text.clear();
            }

            Ok(Event::Text(e)) => {
                if let Ok(t) = e.unescape() {
                    text.push_str(&t);
                }
            }
            Ok(Event::CData(e)) => {
                text.push_str(&String::from_utf8_lossy(&e));
            }

            Ok(Event::End(e)) => {
                let name = e.name().as_ref().to_vec();
                let parent = if stack.len() >= 2 { stack[stack.len() - 2].clone() } else { Vec::new() };
                let value = text.trim().to_string();

                if name == b"item" || name == b"entry" {
                    // Finalize the episode.
                    finalize_episode(&mut item);
                    episodes.push(Value::Object(std::mem::take(&mut item)));
                    in_item = false;
                } else if in_item {
                    apply_item_field(&name, &parent, &value, &mut item, &mut item_has_content_encoded);
                } else {
                    apply_channel_field(&name, &parent, &value, &mut channel);
                }

                stack.pop();
                text.clear();
            }
            _ => {}
        }
        buf.clear();
    }

    // Assemble metadata. feedUrl falls back to the URL we fetched.
    if !channel.contains_key("feedUrl") {
        set_str(&mut channel, "feedUrl", feed_url);
    }
    if !categories.is_empty() {
        channel.insert("genres".into(), json!(categories.clone()));
        channel.insert("categories".into(), json!(categories));
    } else {
        channel.insert("genres".into(), json!([]));
    }
    // descriptionPlain mirrors ABS — a tag-stripped copy of the description.
    if let Some(desc) = channel.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()) {
        let plain = providers::strip_html(&desc);
        channel.insert("descriptionPlain".into(), json!(plain));
    }

    let chapters_present = episodes.iter().any(|e| e.get("chaptersUrl").is_some());
    log::info!(
        target: "skald::metadata",
        "feed parsed episodes={} chapters={chapters_present}",
        episodes.len()
    );

    Ok(json!({ "metadata": Value::Object(channel), "episodes": episodes }))
}

/// Apply attribute-only elements (works for both Empty and Start events).
fn handle_empty(
    e: &BytesStart,
    in_item: bool,
    item: &mut Map<String, Value>,
    channel: &mut Map<String, Value>,
    categories: &mut Vec<String>,
    _feed_url: &str,
) {
    match e.name().as_ref() {
        b"enclosure" => {
            if in_item {
                let mut enc = Map::new();
                if let Some(u) = attr(e, b"url") { enc.insert("url".into(), json!(u)); }
                if let Some(t) = attr(e, b"type") { enc.insert("type".into(), json!(t)); }
                if let Some(l) = attr(e, b"length") {
                    enc.insert("length".into(), json!(l.clone()));
                    if let Ok(n) = l.parse::<i64>() { item.insert("size".into(), json!(n)); }
                }
                if !enc.is_empty() {
                    item.insert("enclosure".into(), Value::Object(enc));
                }
            }
        }
        b"media:content" => {
            // Audio media:content is a fallback enclosure when <enclosure> is absent.
            if in_item && !item.contains_key("enclosure") {
                let is_audio = attr(e, b"type").map(|t| t.starts_with("audio")).unwrap_or(false)
                    || attr(e, b"medium").map(|m| m == "audio").unwrap_or(false);
                if is_audio {
                    let mut enc = Map::new();
                    if let Some(u) = attr(e, b"url") { enc.insert("url".into(), json!(u)); }
                    if let Some(t) = attr(e, b"type") { enc.insert("type".into(), json!(t)); }
                    if !enc.is_empty() {
                        item.insert("enclosure".into(), Value::Object(enc));
                    }
                }
            }
        }
        b"itunes:image" => {
            if let Some(href) = attr(e, b"href") {
                if in_item {
                    item.entry("imageUrl").or_insert_with(|| json!(href.clone()));
                } else {
                    channel.entry("imageUrl").or_insert_with(|| json!(href.clone()));
                    channel.entry("image").or_insert_with(|| json!(href));
                }
            }
        }
        b"itunes:category" => {
            if !in_item {
                if let Some(t) = attr(e, b"text") {
                    let t = t.trim().to_string();
                    if !t.is_empty() && !categories.contains(&t) {
                        categories.push(t);
                    }
                }
            }
        }
        b"podcast:chapters" => {
            if in_item {
                if let Some(u) = attr(e, b"url") { item.insert("chaptersUrl".into(), json!(u)); }
                if let Some(t) = attr(e, b"type") { item.insert("chaptersType".into(), json!(t)); }
            }
        }
        b"atom:link" => {
            // rel="self" carries the canonical feed URL.
            if !in_item {
                let rel = attr(e, b"rel").unwrap_or_default();
                if rel == "self" {
                    if let Some(href) = attr(e, b"href") {
                        channel.entry("feedUrl").or_insert_with(|| json!(href));
                    }
                }
            }
        }
        _ => {}
    }
}

/// Route a channel-level leaf element's text into the metadata map.
fn apply_channel_field(name: &[u8], parent: &[u8], value: &str, channel: &mut Map<String, Value>) {
    match name {
        b"title" if parent == b"channel" => set_str(channel, "title", value),
        b"language" if parent == b"channel" => set_str(channel, "language", value),
        b"link" if parent == b"channel" => set_str(channel, "itunesPageUrl", value),
        b"itunes:author" | b"managingEditor" => {
            if !channel.contains_key("author") { set_str(channel, "author", value); }
        }
        b"itunes:type" => set_str(channel, "type", value),
        b"itunes:new-feed-url" => {
            // Authoritative feed URL override.
            set_str(channel, "feedUrl", value);
        }
        b"itunes:explicit" => {
            channel.insert("explicit".into(), json!(is_explicit(value)));
        }
        b"description" | b"itunes:summary" if parent == b"channel" => {
            if !channel.contains_key("description") { set_str(channel, "description", value); }
        }
        b"pubDate" if parent == b"channel" => set_str(channel, "releaseDate", value),
        // <image><url> — the RSS channel art (used if itunes:image was absent).
        b"url" if parent == b"image" => {
            channel.entry("imageUrl").or_insert_with(|| json!(value.trim()));
            channel.entry("image").or_insert_with(|| json!(value.trim()));
        }
        _ => {}
    }
}

/// Route an item-level leaf element's text into the episode map.
fn apply_item_field(
    name: &[u8],
    parent: &[u8],
    value: &str,
    item: &mut Map<String, Value>,
    has_content_encoded: &mut bool,
) {
    let _ = parent;
    match name {
        b"title" => set_str(item, "title", value),
        b"itunes:subtitle" | b"subtitle" => {
            if !item.contains_key("subtitle") { set_str(item, "subtitle", value); }
        }
        b"itunes:author" | b"author" | b"dc:creator" => {
            if !item.contains_key("author") { set_str(item, "author", value); }
        }
        b"content:encoded" => {
            // content:encoded is the richest body — always wins over <description>.
            set_str(item, "description", value);
            *has_content_encoded = true;
        }
        b"description" | b"itunes:summary" => {
            if !*has_content_encoded && !item.contains_key("description") {
                set_str(item, "description", value);
            }
        }
        b"guid" | b"id" => {
            if !item.contains_key("guid") { set_str(item, "guid", value); }
        }
        b"pubDate" | b"published" => {
            set_str(item, "pubDate", value);
            if let Some(ms) = pubdate_to_ms(value) {
                item.insert("publishedAt".into(), json!(ms));
            }
        }
        b"itunes:duration" => {
            if let Some(secs) = timestamp_to_seconds(value) {
                item.insert("duration".into(), json!(secs));
            }
        }
        b"itunes:episodeType" => set_str(item, "episodeType", value),
        b"itunes:season" => set_str(item, "season", value),
        b"itunes:episode" => set_str(item, "episode", value),
        b"itunes:explicit" => { item.insert("explicit".into(), json!(is_explicit(value))); }
        _ => {}
    }
}

/// Derive descriptionPlain for an episode after its raw fields are collected.
fn finalize_episode(item: &mut Map<String, Value>) {
    if let Some(desc) = item.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()) {
        item.insert("descriptionPlain".into(), json!(providers::strip_html(&desc)));
    }
}

/// ABS treats anything other than "no"/"false"/"clean"/empty as explicit.
fn is_explicit(s: &str) -> bool {
    !matches!(s.trim().to_ascii_lowercase().as_str(), "" | "no" | "false" | "clean")
}

// ── Episode enclosure download ────────────────────────────────────────────────

/// Pick a file extension for a downloaded enclosure from its URL path, then its
/// MIME type, defaulting to mp3 (the dominant podcast codec).
pub fn enclosure_extension(url: &str, mime: Option<&str>) -> String {
    // Strip query/fragment, take the path's extension if it's a known audio one.
    let path = url.split(['?', '#']).next().unwrap_or(url);
    if let Some(ext) = path.rsplit('.').next() {
        let e = ext.to_ascii_lowercase();
        if ["mp3", "m4a", "m4b", "aac", "ogg", "opus", "flac", "wav"].contains(&e.as_str()) {
            return e;
        }
    }
    match mime.unwrap_or("") {
        m if m.contains("mpeg") => "mp3",
        m if m.contains("mp4") || m.contains("m4a") || m.contains("aac") => "m4a",
        m if m.contains("ogg") || m.contains("opus") => "ogg",
        m if m.contains("flac") => "flac",
        m if m.contains("wav") => "wav",
        _ => "mp3",
    }
    .to_string()
}

/// Stream an episode enclosure to `dest` using a temp-file-then-rename so a killed
/// download never leaves a half-written audio file (CLAUDE.md safety posture).
/// When `progress` is supplied, per-chunk `download-progress`/`download-complete`
/// events fire so the existing download toast shows the transfer. Returns bytes.
pub async fn download_enclosure<R: tauri::Runtime>(
    url: &str,
    dest: &std::path::Path,
    progress: Option<(&tauri::AppHandle<R>, &str, &str)>,
) -> Result<u64, String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    use tauri::Emitter;

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create episode dir: {e}"))?;
    }
    let tmp = dest.with_extension("part");

    let client = reqwest::Client::builder()
        .user_agent("Skald/0.1 (local podcasts)")
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client.get(url).send().await.map_err(|e| format!("episode request: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("episode HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    if let Some((app, id, title)) = progress {
        let _ = app.emit("download-progress", json!({ "itemId": id, "title": title, "bytesDownloaded": 0u64, "totalBytes": total }));
    }

    let mut file = tokio::fs::File::create(&tmp).await.map_err(|e| format!("create temp: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("episode network error: {e}"))?;
        downloaded += chunk.len() as u64;
        if let Err(e) = file.write_all(&chunk).await {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(format!("episode write error: {e}"));
        }
        if let Some((app, id, title)) = progress {
            let _ = app.emit("download-progress", json!({ "itemId": id, "title": title, "bytesDownloaded": downloaded, "totalBytes": total }));
        }
    }
    file.flush().await.map_err(|e| format!("flush: {e}"))?;
    drop(file.into_std().await);
    // Atomic publish of the completed file.
    std::fs::rename(&tmp, dest).map_err(|e| format!("rename episode: {e}"))?;
    if let Some((app, id, title)) = progress {
        let _ = app.emit("download-complete", json!({ "itemId": id, "title": title }));
    }
    Ok(downloaded)
}

// ── OPML ──────────────────────────────────────────────────────────────────────
// ABS reads/writes `<outline>` elements with `xmlUrl` (feed) + `text`/`title`.
// Matching this lets OPML files interoperate with the ABS client and other apps.

/// Parse OPML text into a list of `{ title, feedUrl }` (frontend `OpmlFeed`).
pub fn parse_opml(xml: &str) -> Result<Vec<Value>, String> {
    let mut reader = Reader::from_str(xml);
    let mut buf: Vec<u8> = Vec::new();
    let mut feeds: Vec<Value> = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Err(e) => return Err(format!("opml parse: {e}")),
            Ok(Event::Eof) => break,
            Ok(Event::Empty(e)) | Ok(Event::Start(e)) if e.name().as_ref() == b"outline" => {
                if let Some(url) = attr(&e, b"xmlUrl").filter(|u| !u.trim().is_empty()) {
                    let title = attr(&e, b"text").or_else(|| attr(&e, b"title")).unwrap_or_default();
                    feeds.push(json!({ "title": title, "feedUrl": url }));
                }
            }
            _ => {}
        }
        buf.clear();
    }
    Ok(feeds)
}

/// Build an OPML document from `(title, feed_url)` pairs (library export).
pub fn build_opml(feeds: &[(String, String)]) -> String {
    let escape = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    };
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str("<opml version=\"1.0\">\n  <head>\n    <title>Skald Podcast Subscriptions</title>\n  </head>\n  <body>\n");
    for (title, url) in feeds {
        out.push_str(&format!(
            "    <outline type=\"rss\" text=\"{}\" title=\"{}\" xmlUrl=\"{}\" />\n",
            escape(title), escape(title), escape(url)
        ));
    }
    out.push_str("  </body>\n</opml>\n");
    out
}
