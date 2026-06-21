// Audio engine backed by LibVLC via vlc-rs.
//
// Token-in-URL pattern is used exclusively for authenticated media URLs.
// Do NOT switch to HTTP header auth — LibVLC does not reliably forward
// custom headers on Windows (CLAUDE.md critical lesson 2).

use std::ffi::{CStr, CString, c_void};
use std::os::raw::c_char;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::Notify;
use vlc::{Instance, Media, MediaPlayer, MediaPlayerAudioEx, State, EventType};
use crate::eq::EqSettings;

// vlc-rs 0.3.0 does not wrap libvlc_media_add_option; call it directly.
// The symbol is already present in the link graph via the vlc-rs dependency.
extern "C" {
    fn libvlc_media_add_option(p_md: *mut c_void, psz_options: *const c_char);
    fn libvlc_audio_output_device_enum(p_mi: *mut c_void) -> *mut LibVlcAudioOutputDevice;
    fn libvlc_audio_output_device_list_release(p_list: *mut LibVlcAudioOutputDevice);
    fn libvlc_audio_output_device_set(p_mi: *mut c_void, psz_aout: *const c_char, psz_device: *const c_char);
    fn libvlc_audio_equalizer_new() -> *mut c_void;
    fn libvlc_audio_equalizer_release(p_equalizer: *mut c_void);
    fn libvlc_audio_equalizer_set_preamp(p_eq: *mut c_void, f_preamp: f32) -> i32;
    fn libvlc_audio_equalizer_set_amp_at_index(p_eq: *mut c_void, amp: f32, band: u32) -> i32;
    fn libvlc_audio_equalizer_get_band_count() -> u32;
    fn libvlc_audio_equalizer_get_band_frequency(index: u32) -> f32;
    fn libvlc_media_player_set_equalizer(mp: *mut c_void, p_eq: *mut c_void) -> i32;
}

// Mirror of libvlc_audio_output_device_t (linked list node).
#[repr(C)]
struct LibVlcAudioOutputDevice {
    p_next: *mut LibVlcAudioOutputDevice,
    psz_device: *const c_char,
    psz_description: *const c_char,
}

/// One track of a multi-file book. `start_offset` is the track's start position on
/// the book's GLOBAL timeline (cumulative sum of preceding durations) — mirroring
/// ABS's AudioTrack.startOffset (verified against the ABS web client's
/// LocalAudioPlayer, which plays a multi-track book through a single audio element
/// the same way we do here through one LibVLC MediaPlayer).
struct Track {
    /// file:/// URI of the track's audio file.
    uri: String,
    start_offset: f64,
    duration: f64,
}

pub struct AudioPlayer {
    instance: Instance,
    media_player: MediaPlayer,
    eq_handle: *mut c_void,
    // Multi-file book state. Empty for single-file / streamed playback, in which
    // case position/duration/seek behave exactly as before. When populated, the
    // book is a contiguous timeline over these ordered tracks (ABS's model).
    tracks: Mutex<Vec<Track>>,
    // Index into `tracks` of the currently-loaded track.
    current: AtomicUsize,
    // Pinged by the MediaPlayerEndReached callback (which runs on a libvlc thread
    // and must NOT call libvlc — so it only wakes this Notify). A session-owned
    // task awaits it and performs the actual track switch off the callback thread.
    advance: Arc<Notify>,
    // Last playback speed the user set. Re-applied after a track change because
    // LibVLC can reset the rate to 1.0 when the media changes mid-book.
    rate: Mutex<f32>,
}

// SAFETY: libvlc is internally thread-safe. The vlc-rs wrappers are thin raw-pointer
// holders with no non-thread-safe Drop or interior mutability outside of libvlc itself.
unsafe impl Send for AudioPlayer {}
unsafe impl Sync for AudioPlayer {}

impl Drop for AudioPlayer {
    fn drop(&mut self) {
        if !self.eq_handle.is_null() {
            unsafe { libvlc_audio_equalizer_release(self.eq_handle); }
        }
    }
}

impl AudioPlayer {
    pub fn new() -> Result<Self, String> {
        let instance = Instance::new()
            .ok_or_else(|| "Failed to initialize LibVLC instance".to_string())?;
        let media_player = MediaPlayer::new(&instance)
            .ok_or_else(|| "Failed to create LibVLC media player".to_string())?;
        let eq_handle = unsafe { libvlc_audio_equalizer_new() };

        // Attach the end-of-track signal ONCE for the player's lifetime. vlc-rs
        // leaks the callback box (Box::into_raw) and EventManager has no Drop, so
        // this persists after the temporary manager goes out of scope. The closure
        // only wakes a Notify — it never calls libvlc (calling libvlc from an event
        // callback risks a deadlock). It fires for single-file playback too, but no
        // advance task awaits it then, and try_advance() guards on State::Ended +
        // a remaining track, so a stray wake is a harmless no-op.
        let advance = Arc::new(Notify::new());
        {
            let advance_cb = Arc::clone(&advance);
            let em = media_player.event_manager();
            let _ = em.attach(EventType::MediaPlayerEndReached, move |_event, _obj| {
                advance_cb.notify_one();
            });
        }

        Ok(Self {
            instance,
            media_player,
            eq_handle,
            tracks: Mutex::new(Vec::new()),
            current: AtomicUsize::new(0),
            advance,
            rate: Mutex::new(1.0),
        })
    }

    /// Internal: create a Media from `url` (online stream URL or a file:/// URI),
    /// apply the `:start-time` option when a starting offset is needed, and set it
    /// on the player. Shared by single-file load, multi-track load, advance, and
    /// cross-track seek.
    fn set_media_at(&self, url: &str, start_time: f64) -> Result<(), String> {
        let media = Media::new_location(&self.instance, url)
            .ok_or_else(|| format!("Failed to create LibVLC media from URL: {url}"))?;
        if start_time > 0.0 {
            let opt = CString::new(format!(":start-time={:.3}", start_time))
                .map_err(|e| format!("CString error: {e}"))?;
            unsafe {
                libvlc_media_add_option(media.raw() as *mut c_void, opt.as_ptr());
            }
        }
        self.media_player.set_media(&media);
        Ok(())
    }

    /// Load a single media `url`. The caller must append `?token={jwt}` for
    /// authenticated streams — do not use HTTP headers for auth (unreliable on
    /// Windows). Clears any multi-file track state from a previous book so
    /// position/duration/seek revert to single-media behaviour.
    pub fn load(&self, url: &str, start_time: f64) -> Result<(), String> {
        *self.tracks.lock().unwrap() = Vec::new();
        self.current.store(0, Ordering::Relaxed);
        self.set_media_at(url, start_time)
    }

    /// Begin multi-track playback over `tracks_in` (`(uri, duration_secs)`, already
    /// in playback order). Each `uri` is a FINAL media URL — a `file:///…` URI for a
    /// local/downloaded file, or an `http(s)://…?token=…` stream URL for an ABS book.
    /// Builds the global timeline as cumulative offsets (matching how the scanner —
    /// and ABS's audioTracks.startOffset — derive the book's timeline, so a chapter's
    /// global start lines up with its track), then loads the track containing
    /// `start_time` and seeks within it. The caller starts playback and must spawn an
    /// advance task (advance_signal + try_advance) so tracks chain.
    pub fn load_tracks(&self, tracks_in: Vec<(String, f64)>, start_time: f64) -> Result<(), String> {
        if tracks_in.is_empty() {
            return Err("load_tracks: no tracks".to_string());
        }
        let mut acc = 0.0f64;
        let tracks: Vec<Track> = tracks_in
            .into_iter()
            .map(|(uri, duration)| {
                let duration = duration.max(0.0);
                let track = Track { uri, start_offset: acc, duration };
                acc += duration;
                track
            })
            .collect();

        let start = start_time.max(0.0);
        let idx = tracks
            .iter()
            .position(|t| start >= t.start_offset && start < t.start_offset + t.duration)
            .unwrap_or(0);
        let local = (start - tracks[idx].start_offset).max(0.0);
        let uri = tracks[idx].uri.clone();

        *self.tracks.lock().unwrap() = tracks;
        self.current.store(idx, Ordering::Relaxed);
        self.set_media_at(&uri, local)
    }

    /// Returns true while a multi-file book is loaded.
    pub fn is_multitrack(&self) -> bool {
        !self.tracks.lock().unwrap().is_empty()
    }

    /// A handle the session's advance task awaits; the EndReached callback wakes it.
    pub fn advance_signal(&self) -> Arc<Notify> {
        Arc::clone(&self.advance)
    }

    /// Advance to the next track when the current one has ENDED. Returns true if it
    /// moved on. No-op (false) when single-file, not actually ended (guards a stray
    /// wake), or already on the last track (book finished). Called from the session
    /// advance task — never from the libvlc event callback (which only wakes us).
    pub fn try_advance(&self) -> bool {
        if self.media_player.state() != State::Ended {
            return false;
        }
        let (next_uri, next_idx) = {
            let tracks = self.tracks.lock().unwrap();
            let cur = self.current.load(Ordering::Relaxed);
            if cur + 1 >= tracks.len() {
                return false; // last track ended → book finished
            }
            (tracks[cur + 1].uri.clone(), cur + 1)
        };
        self.current.store(next_idx, Ordering::Relaxed);
        if self.set_media_at(&next_uri, 0.0).is_err() {
            return false;
        }
        let _ = self.media_player.play();
        self.reapply_rate();
        true
    }

    pub fn play(&self) -> Result<(), String> {
        self.media_player
            .play()
            .map_err(|_| "LibVLC play() returned an error".to_string())
    }

    pub fn pause(&self) {
        self.media_player.pause();
    }

    /// Seek to `secs` seconds on the book's global timeline. For a single-file book
    /// this is a plain `set_time`. For a multi-file book it resolves which track
    /// contains `secs` (ABS's `findIndex(t => time >= startOffset && time <
    /// startOffset+duration)`); a same-track seek preserves play/pause state, a
    /// cross-track seek loads the target track at the local offset and resumes.
    pub fn seek(&self, secs: f64) -> Result<(), String> {
        let target = secs.max(0.0);
        // Resolve the target without holding the tracks lock across set_media.
        let plan: Option<(usize, f64, String)> = {
            let tracks = self.tracks.lock().unwrap();
            if tracks.is_empty() {
                None
            } else {
                let idx = tracks
                    .iter()
                    .position(|t| target >= t.start_offset && target < t.start_offset + t.duration)
                    .unwrap_or(tracks.len() - 1);
                Some((idx, (target - tracks[idx].start_offset).max(0.0), tracks[idx].uri.clone()))
            }
        };
        match plan {
            // Single-file: set_time takes milliseconds.
            None => self.media_player.set_time((target * 1000.0) as i64),
            Some((idx, local, uri)) => {
                if idx == self.current.load(Ordering::Relaxed) {
                    self.media_player.set_time((local * 1000.0) as i64);
                } else {
                    // Cross-track seek loads the target track at its local offset and
                    // resumes — the common case (scrub / ±30s / chapter jump while
                    // playing). A cross-track seek made while paused will resume,
                    // which mirrors chapter-jump behaviour and avoids LibVLC's awkward
                    // "paused with freshly-set media" state.
                    self.current.store(idx, Ordering::Relaxed);
                    self.set_media_at(&uri, local)?;
                    let _ = self.media_player.play();
                    self.reapply_rate();
                }
            }
        }
        Ok(())
    }

    pub fn set_speed(&self, rate: f32) -> Result<(), String> {
        *self.rate.lock().unwrap() = rate;
        self.media_player
            .set_rate(rate)
            .map_err(|_| "LibVLC set_rate() returned an error".to_string())
    }

    /// Re-apply the user's playback speed after a track change — LibVLC may reset
    /// the rate to 1.0 when the media changes mid-book.
    fn reapply_rate(&self) {
        let r = *self.rate.lock().unwrap();
        let _ = self.media_player.set_rate(r);
    }

    /// Set playback volume. VLC range is 0–200 (100 = 100 %).
    pub fn set_volume(&self, vol: i32) -> Result<(), String> {
        self.media_player
            .set_volume(vol)
            .map_err(|_| "LibVLC set_volume() returned an error".to_string())
    }

    /// Returns the current GLOBAL playback position in seconds. For a multi-file
    /// book this is `currentTrack.start_offset + player_time` (ABS's currentTime
    /// getter); for a single file it's just the player time.
    pub fn position(&self) -> f64 {
        // get_time returns milliseconds, or None if no media is loaded.
        let local = self.media_player.get_time().unwrap_or(0) as f64 / 1000.0;
        let tracks = self.tracks.lock().unwrap();
        if tracks.is_empty() {
            return local;
        }
        let idx = self.current.load(Ordering::Relaxed).min(tracks.len().saturating_sub(1));
        tracks[idx].start_offset + local
    }

    /// Returns total book duration in seconds. For a multi-file book this is the
    /// sum of track durations (last track's end), matching the duration the scanner
    /// reports; for a single file it's the loaded media's duration.
    pub fn duration(&self) -> f64 {
        {
            let tracks = self.tracks.lock().unwrap();
            if let Some(last) = tracks.last() {
                return last.start_offset + last.duration;
            }
        }
        // duration() on Media returns milliseconds.
        self.media_player
            .get_media()
            .and_then(|m| m.duration())
            .unwrap_or(0) as f64
            / 1000.0
    }

    pub fn is_playing(&self) -> bool {
        self.media_player.is_playing()
    }

    /// Returns all audio output devices reported by LibVLC for the current output module.
    pub fn get_audio_devices(&self) -> Vec<crate::models::AudioDevice> {
        unsafe {
            let head = libvlc_audio_output_device_enum(self.media_player.raw() as *mut c_void);
            if head.is_null() {
                return Vec::new();
            }
            let mut devices = Vec::new();
            let mut cur = head;
            while !cur.is_null() {
                let id = if (*cur).psz_device.is_null() {
                    String::new()
                } else {
                    CStr::from_ptr((*cur).psz_device).to_string_lossy().into_owned()
                };
                let name = if (*cur).psz_description.is_null() {
                    id.clone()
                } else {
                    CStr::from_ptr((*cur).psz_description).to_string_lossy().into_owned()
                };
                devices.push(crate::models::AudioDevice { id, name });
                cur = (*cur).p_next;
            }
            libvlc_audio_output_device_list_release(head);
            devices
        }
    }

    /// Switch the active audio output device. Takes effect on next playback.
    pub fn set_audio_device(&self, device_id: &str) {
        if let Ok(id) = CString::new(device_id) {
            unsafe {
                libvlc_audio_output_device_set(
                    self.media_player.raw() as *mut c_void,
                    std::ptr::null(),
                    id.as_ptr(),
                );
            }
        }
    }

    /// Block until the player leaves the NothingSpecial/Opening states, up to
    /// `max_iterations` × 100 ms. Returns `true` if Buffering or Playing was
    /// reached (safe to seek), `false` on timeout or terminal error.
    pub fn wait_until_playable(&self, max_iterations: u32) -> bool {
        for _ in 0..max_iterations {
            match self.media_player.state() {
                State::Buffering | State::Playing | State::Paused => return true,
                State::Error | State::Ended | State::Stopped => return false,
                _ => {}
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        false
    }

    /// Re-apply persisted EQ settings to this player. Called once from session.rs
    /// immediately after the player is first constructed, outside the player mutex,
    /// so the file I/O and FFI cost don't extend the same lock that holds Instance::new().
    pub fn restore_eq(&self) {
        self.apply_eq_settings(&EqSettings::load());
    }

    /// Update a single EQ band gain and re-apply the equalizer to the live player.
    pub fn set_eq_band(&self, band: u32, gain: f32) {
        if self.eq_handle.is_null() { return; }
        unsafe {
            libvlc_audio_equalizer_set_amp_at_index(self.eq_handle, gain, band);
            libvlc_media_player_set_equalizer(self.media_player.raw() as *mut c_void, self.eq_handle);
        }
    }

    /// Update the preamp gain and re-apply the equalizer to the live player.
    pub fn set_eq_preamp(&self, gain: f32) {
        if self.eq_handle.is_null() { return; }
        unsafe {
            libvlc_audio_equalizer_set_preamp(self.eq_handle, gain);
            libvlc_media_player_set_equalizer(self.media_player.raw() as *mut c_void, self.eq_handle);
        }
    }

    /// Bulk-apply an EqSettings struct. Enables or disables the EQ on the live
    /// player according to `settings.enabled`.
    pub fn apply_eq_settings(&self, settings: &EqSettings) {
        if self.eq_handle.is_null() { return; }
        unsafe {
            libvlc_audio_equalizer_set_preamp(self.eq_handle, settings.preamp);
            for (i, &gain) in settings.bands.iter().enumerate() {
                libvlc_audio_equalizer_set_amp_at_index(self.eq_handle, gain, i as u32);
            }
            if settings.enabled {
                libvlc_media_player_set_equalizer(self.media_player.raw() as *mut c_void, self.eq_handle);
            } else {
                libvlc_media_player_set_equalizer(self.media_player.raw() as *mut c_void, std::ptr::null_mut());
            }
        }
    }

    /// Remove the equalizer from the live player (pass NULL to libvlc).
    pub fn disable_eq(&self) {
        unsafe {
            libvlc_media_player_set_equalizer(self.media_player.raw() as *mut c_void, std::ptr::null_mut());
        }
    }

    /// Returns the center frequency (Hz) for each EQ band. Static query.
    pub fn get_band_frequencies(&self) -> Vec<f32> {
        unsafe {
            let count = libvlc_audio_equalizer_get_band_count();
            (0..count)
                .map(|i| libvlc_audio_equalizer_get_band_frequency(i))
                .collect()
        }
    }
}

/// Returns the center frequency (Hz) for each EQ band. Does not require a live player.
pub fn eq_band_frequencies() -> Vec<f32> {
    unsafe {
        let count = libvlc_audio_equalizer_get_band_count();
        (0..count)
            .map(|i| libvlc_audio_equalizer_get_band_frequency(i))
            .collect()
    }
}
