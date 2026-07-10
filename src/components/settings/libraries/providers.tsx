// Metadata-provider panels: custom provider registration + the Open Library
// integration (community ratings + review-cache reset).
// Moved verbatim out of LibrariesSection.tsx (God-File Decomposition roadmap, L3/L7).
import { useState } from 'react';
import { Row, Toggle, MONO, Panel } from '../shared';
import type { OnyxState } from '../../../state/onyx';
import { clearReviewCache } from '../../../api/reviewCache';
import type { CustomMetadataProvider } from '../../../api/abs';
import { SmallBtn, Field } from './widgets';

export function CustomProvidersManager({ providers, onAdd, onDelete }: {
  providers: CustomMetadataProvider[];
  onAdd: (p: { name: string; url: string; mediaType: string; authHeaderValue?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [auth, setAuth] = useState('');
  const [mediaType, setMediaType] = useState<'book' | 'podcast'>('book');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function add() {
    if (!name.trim() || !url.trim()) { setErr('Name and URL are required.'); return; }
    setErr(''); setBusy(true);
    try {
      await onAdd({ name: name.trim(), url: url.trim(), mediaType, authHeaderValue: auth.trim() || undefined });
      setName(''); setUrl(''); setAuth('');
    } catch (e) {
      setErr(typeof e === 'string' ? e : (e as Error)?.message ?? 'Failed to add provider.');
    } finally { setBusy(false); }
  }

  return (
    <Panel label="Custom metadata providers">
      <div style={{ fontSize: 12, color: 'var(--onyx-text-dim)', margin: '10px 2px', lineHeight: 1.5 }}>
        Register a community or self-hosted provider; it then appears in the Provider dropdown above and in the Match dialog.
      </div>

      {providers.length === 0 && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', padding: '4px 0 10px' }}>None registered.</div>
      )}
      {providers.map(p => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--onyx-line)' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-mute)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.mediaType} · {p.url}
            </div>
          </div>
          <SmallBtn danger onClick={() => void onDelete(p.id)}>Delete</SmallBtn>
        </div>
      ))}

      {/* Add form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Field value={name} onChange={setName} placeholder="Provider name" />
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {(['book', 'podcast'] as const).map(mt => (
              <button key={mt} onClick={() => setMediaType(mt)} style={{
                padding: '5px 12px', borderRadius: 6,
                background: mediaType === mt ? 'var(--onyx-accent-dim)' : 'transparent',
                border: `1px solid ${mediaType === mt ? 'var(--onyx-accent-edge)' : 'rgba(255,255,255,0.08)'}`,
                color: mediaType === mt ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
                fontFamily: MONO, fontSize: 10.5, cursor: 'pointer',
              }}>{mt}</button>
            ))}
          </div>
        </div>
        <Field value={url} onChange={setUrl} placeholder="https://provider.example/search" mono />
        <Field value={auth} onChange={setAuth} placeholder="Authorization header value (optional)" mono />
        {err && <div style={{ fontFamily: MONO, fontSize: 11, color: '#e8716a' }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <SmallBtn onClick={add} disabled={busy}>{busy ? 'Adding…' : '+ Add Provider'}</SmallBtn>
        </div>
      </div>
    </Panel>
  );
}

// ── Open Library integration ──────────────────────────────────────────────────
// Moved here from the former standalone Integrations tab — it enriches the player
// with Open Library community ratings, so it lives alongside library settings. The
// review-cache reset is part of the same integration (it clears Open Library data).
export function OpenLibraryManager({ st }: { st: OnyxState }) {
  const [cacheCleared, setCacheCleared] = useState(false);
  return (
    <Panel label="Open Library">
      <div style={{ fontSize: 12, color: 'var(--onyx-text-dim)', margin: '10px 2px 2px', lineHeight: 1.5 }}>
        Enrich the player with community ratings and shelf data from Open Library.
      </div>

      <Row label="Open Library" hint="Community ratings and shelf data.">
        <Toggle on={st.enableOpenLibrary} onChange={st.setEnableOpenLibrary} />
      </Row>

      <Row label="Review cache" hint="Force a fresh fetch of all ratings data on next visit to the Player screen.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {cacheCleared && (
            <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>
              Cache cleared
            </span>
          )}
          <button
            onClick={() => {
              clearReviewCache();
              setCacheCleared(true);
              setTimeout(() => setCacheCleared(false), 2000);
            }}
            style={{
              padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--onyx-glass-edge)',
              color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 10,
              letterSpacing: '0.06em', textTransform: 'uppercase' as const,
            }}
          >
            Clear review cache
          </button>
        </div>
      </Row>
    </Panel>
  );
}
