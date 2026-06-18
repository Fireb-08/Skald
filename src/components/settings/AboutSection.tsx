import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { save } from '@tauri-apps/plugin-dialog';
import lyreIcon from '../../assets/lyre.png';
import { SectionHead, Row, SERIF, MONO } from './shared';
import { writeTextFile } from '../../api/abs';

const ghostBtn = {
  padding: '6px 14px', fontSize: 11, fontFamily: MONO, letterSpacing: '0.06em',
  textTransform: 'uppercase' as const, background: 'var(--onyx-glass)',
  border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, color: 'var(--onyx-text-dim)', cursor: 'pointer',
} as const;

// Canonical SPDX license text for an identifier.
const spdx = (id: string) => `https://spdx.org/licenses/${id}.html`;

// Bundled third-party components grouped by license, each linking to the SPDX
// license text. Mirrored in the vault's "Open Source Licenses.md" backup — keep
// both in sync when deps change.
const LICENSE_GROUPS: { licenses: { id: string; url: string }[]; items: string[]; source?: { label: string; url: string } }[] = [
  {
    licenses: [{ id: 'LGPL-2.1-or-later', url: spdx('LGPL-2.1-or-later') }],
    items: ['LibVLC — VLC media player runtime (audio engine)'],
    source: { label: 'Source: videolan.org', url: 'https://www.videolan.org/vlc/download-sources.html' },
  },
  { licenses: [{ id: 'OFL-1.1 (SIL Open Font License)', url: spdx('OFL-1.1') }], items: ['Inter', 'JetBrains Mono', 'Source Serif 4'] },
  { licenses: [{ id: 'Apache-2.0', url: spdx('Apache-2.0') }, { id: 'MIT', url: spdx('MIT') }], items: ['Tauri & official plugins', '@tauri-apps/api', 'serde / serde_json', 'reqwest', 'keyring', 'directories', 'chrono', 'futures-util', 'base64', 'log'] },
  { licenses: [{ id: 'MIT', url: spdx('MIT') }], items: ['React, React DOM', '@tanstack/react-virtual', 'tokio / tokio-util', 'rust_socketio', 'vlc-rs (LibVLC bindings)', 'zip'] },
];

// Accent link that opens in the system browser via the opener plugin.
function Lnk({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <span
      onClick={() => { void openUrl(url).catch(() => {}); }}
      style={{ color: 'var(--onyx-accent)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
    >{children}</span>
  );
}

// The full third-party notices are large (~3 MB of verbatim license texts), so
// lazy-load them only when the user asks rather than bundling into the main chunk.
async function loadNotices(): Promise<string> {
  const mod = await import('../../assets/THIRD-PARTY-NOTICES.txt?raw');
  return mod.default;
}

function LicensesModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState('');

  const copyFull = async () => {
    setStatus('Loading…');
    try {
      const text = await loadNotices();
      await navigator.clipboard.writeText(text);
      setStatus(`Copied full notices (${Math.round(text.length / 1024)} KB)`);
    } catch (e) { setStatus(`Failed: ${String(e)}`); }
  };

  const saveFull = async () => {
    setStatus('Loading…');
    try {
      const text = await loadNotices();
      const path = await save({ defaultPath: 'THIRD-PARTY-NOTICES.txt', filters: [{ name: 'Text', extensions: ['txt'] }] });
      if (!path) { setStatus(''); return; }
      await writeTextFile(path, text);
      setStatus('Saved');
    } catch (e) { setStatus(`Failed: ${String(e)}`); }
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div style={{ width: '100%', maxWidth: 520, maxHeight: '85vh', background: 'var(--onyx-panel)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 16, boxShadow: '0 40px 100px rgba(0,0,0,0.72), 0 0 0 1px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.06), inset 0 1px 0 rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ flexShrink: 0, padding: '20px 20px 0 22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 500, letterSpacing: '-0.015em' }}>Open source licenses</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', marginTop: 6 }}>Components bundled with Skald</div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, background: 'none', border: '1px solid transparent', color: 'var(--onyx-text-mute)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>✕</button>
        </div>
        <div style={{ flexShrink: 0, height: 1, background: 'var(--onyx-line)', margin: '14px 0 0' }} />

        {/* Groups */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px 6px' }}>
          {LICENSE_GROUPS.map((g, gi) => (
            <div key={gi} style={{ marginBottom: 18 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                {g.licenses.map((l, i) => (
                  <span key={l.id}>
                    {i > 0 && <span style={{ color: 'var(--onyx-text-mute)' }}> OR </span>}
                    <Lnk url={l.url}>{l.id}</Lnk>
                  </span>
                ))}
              </div>
              {g.items.map(it => (
                <div key={it} style={{ fontSize: 12.5, color: 'var(--onyx-text-dim)', padding: '3px 0', lineHeight: 1.4 }}>{it}</div>
              ))}
              {g.source && (
                <div style={{ fontFamily: MONO, fontSize: 10.5, marginTop: 4, letterSpacing: '0.03em' }}>
                  <Lnk url={g.source.url}>{g.source.label}</Lnk>
                </div>
              )}
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: 'var(--onyx-text-mute)', lineHeight: 1.55, paddingTop: 4, paddingBottom: 8 }}>
            License names link to the canonical SPDX text. The complete third-party notices below bundle the verbatim license text and copyright for every shipped Rust crate, npm package, LibVLC, and the fonts.
          </div>
        </div>

        {/* Footer — the full bundled notices (verbatim texts), copy/save on demand */}
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--onyx-line)', padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', flex: 1 }}>
            {status || 'Full third-party notices'}
          </span>
          <button style={{ ...ghostBtn, padding: '6px 12px' }} onClick={() => void copyFull()}>Copy all</button>
          <button style={{ ...ghostBtn, padding: '6px 12px' }} onClick={() => void saveFull()}>Save…</button>
        </div>
      </div>
    </div>
  );
}

export default function AboutSection() {
  const [showLicenses, setShowLicenses] = useState(false);

  return (
    <div>
      <SectionHead title="About" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 0 24px', borderBottom: '1px solid var(--onyx-line)' }}>
        <img
          src={lyreIcon}
          alt="Skald"
          style={{ width: 64, height: 64, objectFit: 'contain', filter: 'drop-shadow(0 0 12px rgba(var(--onyx-accent-r), var(--onyx-accent-g), var(--onyx-accent-b), 0.3))' }}
        />
        <div>
          <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 500 }}>Skald<span style={{ color: 'var(--onyx-accent)' }}>.</span></div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', marginTop: 2 }}>v0.1.0 · Onyx · alpha</div>
          <div style={{ fontSize: 12, color: 'var(--onyx-text-dim)', marginTop: 6, maxWidth: 480 }}>A native desktop client for Audiobookshelf.</div>
        </div>
      </div>

      <Row label="Check for updates" hint="Automatic checks run every 24h.">
        <button style={ghostBtn}>Check now</button>
      </Row>

      <Row label="Open source licenses" hint="Third-party components bundled with Skald and their licenses.">
        <button style={ghostBtn} onClick={() => setShowLicenses(true)}>View</button>
      </Row>

      {showLicenses && <LicensesModal onClose={() => setShowLicenses(false)} />}
    </div>
  );
}
