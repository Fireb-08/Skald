// providers.rs — server-free metadata providers (Local Library roadmap, Phase 5).
//
// For ABS items, metadata search runs on the ABS server (search_books proxies
// Audible/Google/etc.). A standalone local user has no server, so this module
// queries free provider APIs directly and normalizes each result to the same
// SearchResult shape the match UI consumes (title/author/cover/year/…).
//
// Providers implemented: Audible (catalog API), Google Books, Apple iTunes
// (audiobooks), Open Library. All are keyless. Audible is the richest for
// audiobooks — it's the only one that returns narrators and series.

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

/// Strip HTML tags + decode the common entities from a provider blurb (Audible's
/// `publisher_summary` is HTML). Paragraph/line breaks become newlines.
pub(crate) fn strip_html(s: &str) -> String {
    let pre = s
        .replace("</p>", "\n")
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n");
    let mut out = String::with_capacity(pre.len());
    let mut in_tag = false;
    for c in pre.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ");
    out.lines().map(str::trim_end).collect::<Vec<_>>().join("\n").trim().to_string()
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
        "audible" => audible(query, region.unwrap_or("us")).await,
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

/// Map a region code to the Audible marketplace TLD. Defaults to the US store.
fn audible_tld(region: &str) -> &'static str {
    match region.to_ascii_lowercase().as_str() {
        "uk" | "gb" => "co.uk",
        "de" => "de",
        "fr" => "fr",
        "au" => "com.au",
        "ca" => "ca",
        "jp" => "co.jp",
        "it" => "it",
        "es" => "es",
        "in" => "in",
        "br" => "com.br",
        _ => "com",
    }
}

/// Audible catalog search (keyless). The richest audiobook source — uniquely
/// returns narrators and series. `region` selects the marketplace (default US).
async fn audible(query: &str, region: &str) -> Result<Vec<Value>, String> {
    let url = format!(
        "https://api.audible.{}/1.0/catalog/products?num_results=15&products_sort_by=Relevance\
         &response_groups=contributors,product_desc,product_extended_attrs,media,series,product_attrs,category_ladders&image_sizes=500,1000\
         &keywords={}",
        audible_tld(region),
        percent_encode(query)
    );
    let v = get_json(&url).await?;
    let products = v.get("products").and_then(|p| p.as_array()).cloned().unwrap_or_default();
    Ok(products
        .iter()
        .map(|p| {
            // authors / narrators are arrays of { name }; join to a display string.
            let join_names = |key: &str| {
                p.get(key)
                    .and_then(|a| a.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.get("name").and_then(|n| n.as_str()))
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
            };
            let year = p
                .get("release_date")
                .and_then(|d| d.as_str())
                .and_then(|d| d.get(0..4))
                .map(|s| s.to_string());
            // Prefer the 1000px cover, fall back to 500px.
            let cover = p
                .get("product_images")
                .and_then(|im| im.get("1000").or_else(|| im.get("500")))
                .and_then(|u| u.as_str())
                .map(|s| s.to_string());
            // series is [{ title, sequence }]; emit just the first title so it maps
            // cleanly to the Author/Series/Title folder (sequence isn't a folder).
            let series0 = p.get("series").and_then(|s| s.as_array()).and_then(|s| s.first());
            let series_name = series0.and_then(|s| s.get("title")).and_then(|t| t.as_str());
            let sequence = series0.and_then(|s| s.get("sequence")).and_then(|t| t.as_str());
            // Combine into "Name #seq" — the review screen's Series field format,
            // which the local apply splits back into name + sequence.
            let series = match (series_name, sequence) {
                (Some(n), Some(s)) if !s.trim().is_empty() => Some(format!("{n} #{s}")),
                (Some(n), _) => Some(n.to_string()),
                _ => None,
            };
            // Category ladders → genres + tags, the same split Audnexus/ABS use:
            // the root of each ladder is a genre, the deeper levels are tags.
            let mut genres: Vec<String> = Vec::new();
            let mut tags: Vec<String> = Vec::new();
            if let Some(ladders) = p.get("category_ladders").and_then(|c| c.as_array()) {
                for entry in ladders {
                    let Some(ladder) = entry.get("ladder").and_then(|l| l.as_array()) else { continue };
                    for (i, cat) in ladder.iter().enumerate() {
                        let Some(name) = cat.get("name").and_then(|n| n.as_str()).map(str::trim).filter(|s| !s.is_empty()) else { continue };
                        let bucket = if i == 0 { &mut genres } else { &mut tags };
                        if !bucket.iter().any(|x| x == name) {
                            bucket.push(name.to_string());
                        }
                    }
                }
            }
            // A name that's both a genre and a deeper tag stays a genre only.
            tags.retain(|t| !genres.contains(t));
            // The blurb is HTML in `publisher_summary` (needs product_extended_attrs);
            // `merchandising_summary` is a plainer fallback. Strip tags like Audnexus.
            let description = p
                .get("publisher_summary")
                .and_then(|t| t.as_str())
                .or_else(|| p.get("merchandising_summary").and_then(|t| t.as_str()))
                .map(strip_html)
                .filter(|s| !s.is_empty());
            json!({
                "title": p.get("title").and_then(|t| t.as_str()),
                "subtitle": p.get("subtitle").and_then(|t| t.as_str()),
                "author": join_names("authors"),
                "narrator": join_names("narrators"),
                "publisher": p.get("publisher_name").and_then(|t| t.as_str()),
                "publishedYear": year,
                "description": description,
                "cover": cover,
                "series": series,
                "genres": genres,
                "tags": tags,
                "language": p.get("language").and_then(|t| t.as_str()),
                "asin": p.get("asin").and_then(|t| t.as_str()),
                "provider": "audible",
            })
        })
        .collect())
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

/// Search the iTunes podcast directory (keyless). Returns discovery results whose
/// `feedUrl` seeds the local subscribe flow. (Local Podcasts roadmap, Phase 5.)
/// Field names verified against the iTunes Search API podcast response.
pub async fn search_podcasts(query: &str, country: Option<&str>) -> Result<Vec<Value>, String> {
    let url = format!(
        "https://itunes.apple.com/search?media=podcast&limit=25&country={}&term={}",
        percent_encode(country.unwrap_or("us")),
        percent_encode(query)
    );
    log::info!(target: "skald::metadata", "podcast discovery q={query}");
    let v = get_json(&url).await?;
    let results = v.get("results").and_then(|r| r.as_array()).cloned().unwrap_or_default();
    Ok(results
        .iter()
        .filter_map(|r| {
            // A result with no feedUrl can't be subscribed to — drop it.
            let feed_url = r.get("feedUrl").and_then(|u| u.as_str())?;
            let cover = r
                .get("artworkUrl600")
                .or_else(|| r.get("artworkUrl100"))
                .and_then(|a| a.as_str())
                .map(|s| s.to_string());
            Some(json!({
                "title": r.get("collectionName").or_else(|| r.get("trackName")).and_then(|t| t.as_str()),
                "author": r.get("artistName").and_then(|t| t.as_str()),
                "feedUrl": feed_url,
                "cover": cover,
                "genres": r.get("genres").cloned().unwrap_or_else(|| json!([])),
                "trackCount": r.get("trackCount").and_then(|t| t.as_i64()),
                "itunesId": r.get("collectionId").and_then(|t| t.as_i64()),
            }))
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
