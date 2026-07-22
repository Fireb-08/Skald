use skald_lib::api::AbsClient;
use skald_lib::models::{MeResponse, MediaProgress};
use std::env;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::{sleep, Duration};

async fn capture_one_request(listener: TcpListener) -> String {
    let (mut stream, _) = listener.accept().await.expect("accept test request");
    let mut request = Vec::new();
    let mut chunk = [0_u8; 4096];
    let target_len = loop {
        let read = stream.read(&mut chunk).await.expect("read test request");
        assert!(read > 0, "connection closed before request was complete");
        request.extend_from_slice(&chunk[..read]);

        let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n") else {
            continue;
        };
        let header_end = header_end + 4;
        let content_length = {
            let headers = String::from_utf8_lossy(&request[..header_end]);
            headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().expect("valid content-length"))
                })
                .unwrap_or(0)
        };
        break header_end + content_length;
    };

    while request.len() < target_len {
        let read = stream.read(&mut chunk).await.expect("read request body");
        assert!(
            read > 0,
            "connection closed before request body was complete"
        );
        request.extend_from_slice(&chunk[..read]);
    }

    stream
        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        .await
        .expect("write test response");

    String::from_utf8(request[..target_len].to_vec()).expect("request is UTF-8")
}

#[tokio::test]
async fn sync_session_posts_expected_payload() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test server");
    let address = listener.local_addr().expect("test server address");
    let request_task = tokio::spawn(capture_one_request(listener));

    AbsClient::new(format!("http://{address}"))
        .with_token("test-token".to_string())
        .sync_session("session-123", 123.5, 9.25)
        .await
        .expect("sync request succeeds");

    let request = request_task.await.expect("capture task succeeds");
    let (headers, body) = request
        .split_once("\r\n\r\n")
        .expect("request has a body boundary");
    assert_eq!(
        headers.lines().next(),
        Some("POST /api/session/session-123/sync HTTP/1.1")
    );
    assert!(
        headers.lines().any(|line| {
            line.split_once(':').is_some_and(|(name, value)| {
                name.eq_ignore_ascii_case("authorization") && value.trim() == "Bearer test-token"
            })
        }),
        "sync request must authenticate with the configured bearer token"
    );

    let payload: serde_json::Value = serde_json::from_str(body).expect("valid JSON body");
    assert_eq!(payload["currentTime"], serde_json::json!(123.5));
    assert_eq!(payload["timeListened"], serde_json::json!(9.25));
}

fn required_env(name: &str) -> String {
    env::var(name).unwrap_or_else(|_| {
        panic!("{name} is required; use a dedicated ABS test account and never commit its token")
    })
}

fn item_progress<'a>(me: &'a MeResponse, item_id: &str) -> Option<&'a MediaProgress> {
    me.media_progress
        .iter()
        .find(|progress| progress.library_item_id == item_id && progress.episode_id.is_none())
}

fn choose_marker(duration: f64, original: Option<&MediaProgress>) -> Result<f64, String> {
    if !duration.is_finite() || duration < 120.0 {
        return Err(format!(
            "test item duration must be at least 120 seconds; received {duration}"
        ));
    }

    let candidates = [duration * 0.23, duration * 0.37, duration * 0.51];
    candidates
        .into_iter()
        .map(|candidate| candidate.clamp(30.0, duration - 60.0))
        .find(|candidate| {
            original.is_none_or(|progress| (progress.current_time - candidate).abs() > 2.0)
        })
        .ok_or_else(|| "could not choose a marker distinct from existing progress".to_string())
}

/// Writes a distinctive playback position through the real session-sync route, reads it back
/// from `/api/me`, and restores the original progress. This is ignored by default because it
/// deliberately mutates a live server and requires a dedicated account and audiobook.
#[tokio::test]
#[ignore = "requires SKALD_ABS_TEST_URL, SKALD_ABS_TEST_TOKEN, and SKALD_ABS_TEST_ITEM_ID"]
async fn live_abs_persists_session_progress() {
    let server_url = required_env("SKALD_ABS_TEST_URL");
    let token = required_env("SKALD_ABS_TEST_TOKEN");
    let item_id = required_env("SKALD_ABS_TEST_ITEM_ID");
    let client = AbsClient::new(server_url).with_token(token);

    let before = client.get_me().await.expect("read original ABS progress");
    let original = item_progress(&before, &item_id).cloned();
    let session = client
        .open_session(&item_id, None, None)
        .await
        .expect("open ABS playback session");
    let duration = session
        .audio_tracks
        .iter()
        .map(|track| track.duration)
        .sum::<f64>();
    let marker = match choose_marker(duration, original.as_ref()) {
        Ok(marker) => marker,
        Err(error) => {
            let _ = client
                .close_session(&session.id, session.current_time, 0.0)
                .await;
            let _ = client.delete_session(&session.id).await;
            panic!("choose test marker: {error}");
        }
    };

    // Keep validation fallible until after cleanup so a failed assertion cannot strand test data.
    let validation = async {
        client
            .sync_session(&session.id, marker, 1.0)
            .await
            .map_err(|error| format!("ABS rejected the sync request: {error}"))?;

        for _ in 0..20 {
            let me = client
                .get_me()
                .await
                .map_err(|error| format!("failed to read progress back from ABS: {error}"))?;
            if let Some(progress) = item_progress(&me, &item_id) {
                if (progress.current_time - marker).abs() <= 0.5 {
                    return Ok(progress.clone());
                }
            }
            sleep(Duration::from_millis(250)).await;
        }

        Err(format!(
            "ABS did not report the synced marker {marker:.3} within five seconds"
        ))
    }
    .await;

    let close_result = client.close_session(&session.id, marker, 1.0).await;
    let restore_result = match original.as_ref() {
        Some(progress) => {
            client
                .update_progress(
                    &item_id,
                    None,
                    progress.current_time,
                    progress.duration,
                    progress.is_finished,
                )
                .await
        }
        None => match client.get_me().await {
            Ok(me) => match item_progress(&me, &item_id) {
                Some(created) => client.delete_progress(&created.id).await,
                None => Ok(()),
            },
            Err(error) => Err(error),
        },
    };

    // Admin test accounts can remove the listening-history row too; progress restoration above
    // is still the required cleanup when the account intentionally has ordinary user privileges.
    let _ = client.delete_session(&session.id).await;

    close_result.expect("close the live test session during cleanup");
    restore_result.expect("restore the original ABS progress during cleanup");
    let observed = validation.expect("ABS persists session sync and returns it through /api/me");
    assert_eq!(observed.library_item_id, item_id);
}
