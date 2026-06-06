**Definitely removable (no audio-only use case):**

- `gui/` (19 M) — VLC's own Qt/Skins interfaces; you drive playback via libvlc API
- `video_output/` (3.5 M), `video_filter/` (2.9 M), `video_chroma/` (2.2 M), `video_splitter/` (196 K), `d3d11/` (208 K), `d3d9/` (152 K) — all video rendering, ~9 M
- `visualization/` (2.1 M) — spectrum/waveform plugins
- `access_output/` (5.5 M), `stream_out/` (3.9 M) — streaming/recording output, not playback
- `mux/` (932 K) — muxing for output/transcode, not playback
- `spu/` (1004 K), `text_renderer/` (3.1 M) — subtitle rendering, ~4 M
- `control/` (484 K) — hotkey/gesture/HTTP control interfaces; you control via API
- `lua/` (388 K), `services_discovery/` (1.4 M), `meta_engine/` (1.6 M) — playlist scripting, network discovery, online metadata fetch; Skald fetches metadata via the ABS API, not VLC

That is roughly **57 M** of unambiguous removals.

**Must keep (audio playback core):**

- `codec/` — but this is 45 M because it includes every video codec. This folder needs selective pruning, not wholesale keep or remove. Keep the audio decoders (mp3/mpeg audio, aac/faad, flac, vorbis, opus, a52, dca, alac); the video codec DLLs inside it are the bulk of the 45 M.
- `audio_output/` (388 K), `audio_filter/` (3.9 M), `audio_mixer/` (92 K) — output backends, resampling, speed/pitch
- `demux/` (11 M) — container parsing; keep, though it also carries video-container demuxers that may be trimmable later
- `packetizer/` (1.0 M) — keep; feeds decoders
- `access/` (20 M) — file and network access; keep the `file`, `http`, `https`, `tls` plugins. Much of the 20 M is optical disc (dvd/bluray/vcd), capture devices, and screen capture, which are removable.

**Needs testing before removal:**

- `misc/` (4.3 M) — mixed bag; contains some required runtime modules (e.g. inflate, gcrypt, the threading/clock helpers). Do not remove wholesale.
- `stream_filter/` (504 K), `stream_extractor/` (508 K) — `stream_extractor` handles archive-embedded media; may matter for some audiobook packaging
- `logger/` (132 K), `keystore/` (116 K) — small; low priority, keep for now