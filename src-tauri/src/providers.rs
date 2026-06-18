// providers.rs — server-free metadata providers (Local Library roadmap, Phase 5).
//
// For ABS items, metadata search runs on the ABS server (search_books proxies
// Audible/Google/etc.). A standalone local user has no server, so this module
// queries free provider APIs directly and normalizes each result to the same
// SearchResult shape the match UI consumes (title/author/cover/year/…).
//
// Providers implemented: Google Books, Apple iTunes (audiobooks), Open Library.
// All are keyless. Audnexus/Audible search needs an ASIN-first flow and is left
// for a later pass (noted in the roadmap).

use serde_json::{json, Value};
use std::path::Path;

/// Percent-encode a query string for a URL query value (RFC 3986 unreserved set).
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Skald/0.1 (local library metadata)")
        .build()
        .map_err(|e| format!("http client: {e}"))
}

async fn get_json(url: &str) -> Result<Value, String> {
    let resp = client()?.get(url).send().await.map_err(|e| format!("request: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("provider HTTP {}", resp.status()));
    }
    resp.json::<Value>().await.map_err(|e| format!("parse: {e}"))
}

/// Search a provider and return SearchResult-shaped candidates.
pub async fn search(query: &str, provider: &str, region: Option<&str>) -> Result<Vec<Value>, String> {
    log::info!(target: "skald::metadata", "provider search provider={provider} q={query}");
    let out = match provider {
        "itunes" => itunes(query, region.unwrap_or("us")).await,
        "openlibrary" => openlibrary(query).await,
        _ => google(query).await, // default + "google"
    };
    match &out {
        Ok(v) => log::info!(target: "skald::metadata", "provider results provider={provider} n={}", v.len()),
        Err(e) => log::warn!(target: "skald::metadata", "provider FAIL provider={provider} err={e}"),
    }
    out
}

async fn google(query: &str) -> Result<Vec<Value>, String> {
    let url = format!(
        "https://www.googleapis.com/books/v1/volumes?maxResults=15&q={}",
        percent_encode(query)
    );
    let v = get_json(&url).await?;
    let items = v.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
    Ok(items
        .iter()
        .map(|it| {
            let vi = it.get("volumeInfo").cloned().unwrap_or(Value::Null);
            let author = vi
                .get("authors")
                .and_then(|a| a.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "));
            let year = vi
                .get("publishedDate")
                .and_then(|d| d.as_str())
                .and_then(|d| d.get(0..4))
                .map(|s| s.to_string());
            let cover = vi
                .get("imageLinks")
                .and_then(|l| l.get("thumbnail"))
                .and_then(|t| t.as_str())
                .map(|s| s.replace("http://", "https://"));
            json!({
                "title": vi.get("title").and_then(|t| t.as_str()),
                "subtitle": vi.get("subtitle").and_then(|t| t.as_str()),
                "author": author,
                "narrator": Value::Null,
                "publisher": vi.get("publisher").and_then(|t| t.as_str()),
                "publishedYear": year,
                "description": vi.get("description").and_then(|t| t.as_str()),
                "cover": cover,
                "series": Value::Null,
                "genres": vi.get("categories").cloned().unwrap_or(json!([])),
                "language": vi.get("language").and_then(|t| t.as_str()),
                "provider": "google",
            })
        })
        .collect())
}

async fn itunes(query: &str, country: &str) -> Result<Vec<Value>, String> {
    let url = format!(
        "https://itunes.apple.com/search?media=audiobook&limit=15&country={}&term={}",
        percent_encode(country),
        percent_encode(query)
    );
    let v = get_json(&url).await?;
    let results = v.get("results").and_then(|r| r.as_array()).cloned().unwrap_or_default();
    Ok(results
        .iter()
        .map(|r| {
            // Request a larger artwork than the default 100×100 thumbnail.
            let cover = r
                .get("artworkUrl100")
                .and_then(|a| a.as_str())
                .map(|s| s.replace("100x100", "600x600"));
            let year = r
                .get("releaseDate")
                .and_then(|d| d.as_str())
                .and_then(|d| d.get(0..4))
                .map(|s| s.to_string());
            let title = r.get("collectionName").or_else(|| r.get("trackName")).and_then(|t| t.as_str());
            let genres = r
                .get("primaryGenreName")
                .and_then(|g| g.as_str())
                .map(|g| json!([g]))
                .unwrap_or_else(|| json!([]));
            json!({
                "title": title,
                "subtitle": Value::Null,
                "author": r.get("artistName").and_then(|t| t.as_str()),
                "narrator": Value::Null,
                "publisher": Value::Null,
                "publishedYear": year,
                "description": r.get("description").and_then(|t| t.as_str()),
                "cover": cover,
                "series": Value::Null,
                "genres": genres,
                "language": Value::Null,
                "provider": "itunes",
            })
        })
        .collect())
}

async fn openlibrary(query: &str) -> Result<Vec<Value>, String> {
    let url = format!(
        "https://openlibrary.org/search.json?limit=15&q={}",
        percent_encode(query)
    );
    let v = get_json(&url).await?;
    let docs = v.get("docs").and_then(|d| d.as_array()).cloned().unwrap_or_default();
    Ok(docs
        .iter()
        .map(|d| {
            let author = d
                .get("author_name")
                .and_then(|a| a.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "));
            let cover = d
                .get("cover_i")
                .and_then(|c| c.as_i64())
                .map(|id| format!("https://covers.openlibrary.org/b/id/{id}-L.jpg"));
            let genres = d
                .get("subject")
                .and_then(|s| s.as_array())
                .map(|s| Value::Array(s.iter().take(6).cloned().collect()))
                .unwrap_or_else(|| json!([]));
            json!({
                "title": d.get("title").and_then(|t| t.as_str()),
                "subtitle": Value::Null,
                "author": author,
                "narrator": Value::Null,
                "publisher": Value::Null,
                "publishedYear": d.get("first_publish_year").and_then(|y| y.as_i64()).map(|y| y.to_string()),
                "description": Value::Null,
                "cover": cover,
                "series": Value::Null,
                "genres": genres,
                "language": d.get("language").and_then(|l| l.as_array()).and_then(|l| l.first()).and_then(|x| x.as_str()),
                "provider": "openlibrary",
            })
        })
        .collect())
}

/// Download a cover image to `dest` (best-effort; used by the match-apply flow).
pub async fn download_cover(url: &str, dest: &Path) -> Result<(), String> {
    let bytes = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("cover request: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("cover body: {e}"))?;
    std::fs::write(dest, &bytes).map_err(|e| format!("cover write: {e}"))?;
    log::info!(target: "skald::metadata", "cover saved {}", dest.display());
    Ok(())
}
