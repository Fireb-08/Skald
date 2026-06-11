// Audio engine backed by LibVLC via vlc-rs.
//
// Token-in-URL pattern is used exclusively for authenticated media URLs.
// Do NOT switch to HTTP header auth — LibVLC does not reliably forward
// custom headers on Windows (CLAUDE.md critical lesson 2).

use std::ffi::{CStr, CString, c_void};
use std::os::raw::c_char;
use vlc::{Instance, Media, MediaPlayer, MediaPlayerAudioEx, State};
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

pub struct AudioPlayer {
    instance: Instance,
    media_player: MediaPlayer,
    eq_handle: *mut c_void,
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
        Ok(Self { instance, media_player, eq_handle })
    }

    /// Load media from `url`. The caller must append `?token={jwt}` before
    /// calling this — do not use HTTP headers for auth (they are unreliable).
    /// If `start_time > 0.0`, the `:start-time` media option is applied via FFI
    /// so VLC begins decoding from that position before any audio is output.
    pub fn load(&self, url: &str, start_time: f64) -> Result<(), String> {
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

    pub fn play(&self) -> Result<(), String> {
        self.media_player
            .play()
            .map_err(|_| "LibVLC play() returned an error".to_string())
    }

    pub fn pause(&self) {
        self.media_player.pause();
    }

    /// Seek to `secs` seconds from the start.
    pub fn seek(&self, secs: f64) -> Result<(), String> {
        // set_time takes milliseconds
        self.media_player.set_time((secs * 1000.0) as i64);
        Ok(())
    }

    pub fn set_speed(&self, rate: f32) -> Result<(), String> {
        self.media_player
            .set_rate(rate)
            .map_err(|_| "LibVLC set_rate() returned an error".to_string())
    }

    /// Set playback volume. VLC range is 0–200 (100 = 100 %).
    pub fn set_volume(&self, vol: i32) -> Result<(), String> {
        self.media_player
            .set_volume(vol)
            .map_err(|_| "LibVLC set_volume() returned an error".to_string())
    }

    /// Returns current playback position in seconds.
    pub fn position(&self) -> f64 {
        // get_time returns milliseconds, or None if no media is loaded
        self.media_player.get_time().unwrap_or(0) as f64 / 1000.0
    }

    /// Returns total media duration in seconds.
    pub fn duration(&self) -> f64 {
        // duration() on Media returns milliseconds
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
