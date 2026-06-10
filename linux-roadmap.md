# Skald — Linux Support Roadmap

Companion to `ROADMAP.md`. Targets Linux as a second-class-but-shippable platform after the Windows 11 x64 baseline is stable.

---

## Review of incoming assumptions

### 1. Keyring platform adaptation — confirmed, with a trap

`src-tauri/Cargo.toml:27` hardcodes `features = ["windows-native"]`. Swapping in `linux-native-sync-persistent` (Secret Service via libsecret) is the textbook fix, and `src-tauri/src/auth.rs` needs no code changes — `Entry::new(SERVICE, ACCOUNT)` is the same call.

The trap: headless or minimal environments without an unlocked Secret Service daemon (some i3/Sway setups, SSH sessions, CI runners, GNOME with the keyring locked) will fail at `Entry::new`, not silently fall back. Plan for a clear error surface and consider an encrypted-file fallback as a follow-up if user reports come in.

### 2. LibVLC packaging strategy — confirmed, and it is the bigger lift

`src-tauri/build.rs` and `src-tauri/tauri.conf.json:46-51` bake in Windows DLL layout (`vlc-dist/libvlc.dll`, `libvlccore.dll`, `vlc-cache-gen.exe`, `plugins/`). Three viable Linux strategies, each with consequences:

| Strategy | Pros | Cons |
|---|---|---|
| **AppImage with bundled `libvlc.so` + plugins** | Single artifact, distro-independent, matches "ship a binary" feel of NSIS | Larger artifact; needs AppRun wrapper to set `VLC_PLUGIN_PATH` |
| **.deb / .rpm against system `libvlc5`** | Small artifact, distro-managed updates | Distro matrix burden; version skew across Ubuntu/Fedora/Arch |
| **Flatpak with `org.videolan.VLC` BaseApp** | Cleanest sandboxing, store presence | Sandbox limits Secret Service access; more upfront infra |

Recommendation: **AppImage as the primary target.** Flatpak as a later follow-up.

### 3. Window chrome visual fidelity — risk acknowledged, slightly worse than framed

Two compounding issues:

- **`src/components/chrome/Titlebar.tsx:20`** uses `'Segoe MDL2 Assets'` for the maximize glyph. Will render as tofu on every Linux box. Cheap fix (inline SVG) but it must actually be done.
- **`decorations: false, transparent: true`** in `tauri.conf.json:20-22` needs a compositor for transparency. Works on Mutter/KWin/Wayland-with-compositor; degrades to opaque on minimal WMs. Tauri's `data-tauri-drag-region` has historically been finicky on Wayland depending on the webkit2gtk version shipped.

Agreed: visual, not functional. Not a blocker.

---

## Gaps in the two-task framing

Items not on the user's original list but on this roadmap:

1. **Asset protocol scope** — `tauri.conf.json:31` hardcodes `$HOME/AppData/Local/skald/...`. Must become a cross-platform Tauri variable (`$APPCACHE`) so Linux resolves to `$XDG_CACHE_HOME/skald/...`. The Rust side already uses the `directories` crate correctly; only the Tauri config is wrong.
2. **Bundle targets** — `"targets": ["nsis"]` needs `["appimage"]` (or chosen subset) added under a Linux-conditional config.
3. **NSIS installer hook** — `windows/hooks.nsh` is gated under `bundle.windows` and harmless on Linux. No equivalent needed for AppImage.
4. **WebView delta** — WebKit2GTK ≠ WebView2. Media element behavior, IndexedDB quotas, font rendering, `backdrop-filter` support all differ. Worth one explicit smoke-test pass.
5. **Audio device enumeration** — `audio.rs` calls `libvlc_audio_output_device_enum`. Device naming on PulseAudio/PipeWire differs from WASAPI; verify the device selector UI still reads sensibly.

---

## Phased plan

### Phase L1 — Build & boot (1–2 days)

- Add Linux conditional to `src-tauri/Cargo.toml`:
  ```toml
  [target.'cfg(windows)'.dependencies]
  keyring = { version = "3", features = ["windows-native"] }

  [target.'cfg(target_os = "linux")'.dependencies]
  keyring = { version = "3", features = ["linux-native-sync-persistent"] }
  ```
- Refactor `src-tauri/build.rs` to no-op on Linux (system libvlc via pkg-config initially); gate the `vlc-dist` copy behind `cfg(windows)`.
- Fix `tauri.conf.json:31` asset scope to use `$APPCACHE/skald/cache/covers/**` instead of `$HOME/AppData/Local/...`.
- Install `libvlc-dev`, `libwebkit2gtk-4.1-dev`, `libsecret-1-dev` on the Linux dev box.
- Get `pnpm tauri dev` running. **Verification:** app launches, login screen renders.

### Phase L2 — Functional parity (2–4 days)

- Verify keyring round-trip on GNOME + KDE. Document the Secret Service prerequisite. Surface a clear error in `auth.rs` when the daemon is absent rather than the raw `KeyringError`.
- Smoke-test `audio.rs`: load, play/pause, seek, device enumeration, shutdown sync. Confirm token-in-URL auth still works against the dev server.
- Smoke-test downloads (`download_item` cancel path), socket sync, cover cache pathing, global shortcut registration.
- **Verification:** complete listen-a-chapter-and-quit happy path with correct progress persistence.

### Phase L3 — Window chrome (1–2 days)

- Replace Segoe MDL2 glyph in `Titlebar.tsx:20` with inline SVG icons. Match the existing icon visual weight. Keep button dimensions (46×44).
- Decide control order policy. Recommendation: **keep right-aligned** (matches Windows/KDE). Predictability beats per-DE detection.
- Test transparency on GNOME Wayland + KDE X11. If transparency fails on a target, fall back to a solid `var(--onyx-bg)` — the design tolerates this.
- Test `data-tauri-drag-region` on Wayland; if broken, add a manual `mousedown` handler that calls `getCurrentWindow().startDragging()`.
- **Verification:** titlebar buttons render correctly, drag works, window controls work, transparency works or degrades cleanly.

### Phase L4 — Packaging (3–5 days, the real work)

- Add `appimage` to bundle targets in `tauri.conf.json` under a Linux-conditional block.
- Bundle `libvlc.so.5`, `libvlccore.so.9`, and the `plugins/` tree into the AppDir.
- Write an AppRun wrapper that sets `VLC_PLUGIN_PATH=$APPDIR/usr/lib/vlc/plugins` before exec'ing the binary. Tauri's `appimage` bundler handles the basics but VLC plugin discovery needs this.
- Verify on at least **Ubuntu 22.04 LTS + Fedora 40**. libc and webkit2gtk skew is the blast radius.
- **Verification:** AppImage runs on a clean VM with no VLC pre-installed.

### Phase L5 — CI + release (1–2 days)

- Add Linux runner alongside the Windows release job. Produce AppImage artifact next to the NSIS installer.
- Document in `README.md`: keyring prerequisite (Secret Service), AppImage usage, minimum compositor expectations, libvlc plugin path override env var for power users.
- **Verification:** tagged release produces both `.exe` and `.AppImage` artifacts; both install and run on clean targets.

---

## Estimate

**1.5–2.5 weeks of focused work**, with L4 being the longest pole.

If AppImage is deferred and the strategy shifts to `.deb` against system libvlc, L4 drops to ~1 day but you inherit the distro support matrix and lose the single-artifact convenience.

---

## Out of scope for this roadmap

- macOS support (separate roadmap; requires `macos-native` keyring, libvlc in `Skald.app/Contents/Frameworks/`, and a notarization flow)
- Flatpak (follow-up after AppImage proves the bundling pattern works)
- Wayland-specific hardening beyond drag-region (CSD vs SSD policy, fractional scaling edge cases)
- Code signing for Linux artifacts (sha256sums + GPG-signed release manifest is sufficient v1)
