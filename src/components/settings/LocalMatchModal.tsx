import { useState, useEffect } from 'react';
import type { OnyxState } from '../../state/onyx';
import type { ScannedItem, MetadataResult, AuthorObject } from '../../api/abs';
import { searchMetadata, applyLocalMatch } from '../../api/abs';
import { log } from '../../lib/log';
import { MONO, SERIF, DIM_GOLD, Seg } from './shared';

// Match-against-a-source modal for a quarantined local book (Phase 5).
// Searches free providers (Google Books / iTunes / Open Library) and files the
// chosen result into the Author/Series/Title tree, fetching its cover.
export interface LocalMatchModalProps {
  st: OnyxState;
  libraryId: string;
  item: ScannedItem;
  onClose: () => void;
  onApplied: () => void;
}

const PROVIDERS: { id: string; label: string }[] = [
  { id: 'google', label: 'Google Books' },
  { id: 'itunes', label: 'iTunes' },
  { id: 'openlibrary', label: 'Open Library' },
];

function folderName(p: string) {
  return p.split(/[\\/]/).filter(Boolean).pop() || '';
}

// authorName can be a string, an object, or an array of objects (ABS untagged
// shape); normalize to a plain string for the seed query / manual fields.
function authorStr(a: string | AuthorObject | AuthorObject[] | undefined | null): string {
  if (!a) return '';
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) return a.map(x => x.name).join(', ');
  return a.name;
}

export default function LocalMatchModal({ st, libraryId, item, onClose, onApplied }: LocalMatchModalProps) {
  const seedTitle = item.item.media?.metadata?.title || folderName(item.sourcePath);
  const seedAuthor = authorStr(item.item.media?.metadata?.authorName);

  const [provider, setProvider] = useState('google');
  const [query, setQuery] = useState([seedTitle, seedAuthor].filter(Boolean).join(' '));
  const [results, setResults] = useState<MetadataResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  // Manual override fields for "file as entered".
  const [mTitle, setMTitle] = useState(seedTitle);
  const [mAuthor, setMAuthor] = useState(seedAuthor);
  const [mSeries, setMSeries] = useState('');

  async function runSearch() {
    if (!query.trim()) return;
    setLoading(true);
    try {
      // Region is an Audible/Audnexus concern; wired in a later pass.
      const r = await searchMetadata(query.trim(), provider);
      setResults(r);
    } catch (e) {
      log.error('metadata', 'provider search failed', { err: String(e) });
      st.setToast({ message: 'Search failed', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  // Auto-search once on open with the seed query.
  useEffect(() => { void runSearch(); /* eslint-disable-next-line */ }, [provider]);

  async function apply(title: string, author: string, series?: string | null, cover?: string | null) {
    if (!title.trim() || !author.trim()) {
      st.setToast({ message: 'Title and author are required', type: 'error' });
      return;
    }
    setApplying(true);
    try {
      log.info('metadata', 'apply match', { provider, title });
      await applyLocalMatch(libraryId, item.sourcePath, title.trim(), author.trim(), series || null, cover || null);
      st.setToast({ message: `Filed "${title.trim()}"`, type: 'success' });
      onApplied();
      onClose();
    } catch (e) {
      log.error('metadata', 'apply match failed', { err: String(e) });
      st.setToast({ message: 'Could not file book', type: 'error' });
    } finally {
      setApplying(false);
    }
  }

  const input: React.CSSProperties = {
    padding: '8px 12px', fontSize: 13, background: 'rgba(0,0,0,0.3)', borderRadius: 8,
    color: 'var(--onyx-text)', border: '1px solid var(--onyx-glass-edge)', outline: 'none',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 720, maxWidth: '100%', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
          background: 'var(--onyx-bg)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 14,
          overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--onyx-line)' }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: DIM_GOLD }}>Match unidentified book</div>
          <div style={{ marginTop: 4, fontFamily: SERIF, fontSize: 18 }}>{folderName(item.sourcePath)}</div>
        </div>

        {/* Search controls */}
        <div style={{ padding: '14px 20px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid var(--onyx-line)' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void runSearch(); }}
            placeholder="Search title and author…"
            style={{ ...input, flex: 1 }}
          />
          <button onClick={() => void runSearch()} disabled={loading} style={{ ...input, cursor: 'pointer', color: 'var(--onyx-accent)', borderColor: 'var(--onyx-accent-edge)', background: 'var(--onyx-accent-dim)' }}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div style={{ padding: '10px 20px', display: 'flex', gap: 6, alignItems: 'center', borderBottom: '1px solid var(--onyx-line)' }}>
          <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>Source</span>
          {PROVIDERS.map(p => <Seg key={p.id} active={provider === p.id} onClick={() => setProvider(p.id)}>{p.label}</Seg>)}
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', minHeight: 120 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--onyx-text-mute)', fontSize: 13 }}>Searching…</div>
          ) : results.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--onyx-text-mute)', fontSize: 13 }}>No results — refine the query or try another source.</div>
          ) : (
            results.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 8px', borderBottom: '1px solid var(--onyx-line)', alignItems: 'center' }}>
                <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }}>
                  {r.cover && <img src={r.cover} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.title}{r.publishedYear ? ` (${r.publishedYear})` : ''}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--onyx-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.author || 'Unknown author'}</div>
                </div>
                <button
                  onClick={() => apply(r.title || mTitle, r.author || mAuthor, typeof r.series === 'string' ? r.series : null, r.cover)}
                  disabled={applying}
                  style={{ ...input, cursor: 'pointer', flexShrink: 0, color: 'var(--onyx-accent)', borderColor: 'var(--onyx-accent-edge)', background: 'var(--onyx-accent-dim)', fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}
                >
                  Use
                </button>
              </div>
            ))
          )}
        </div>

        {/* Manual file-as-entered */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--onyx-line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>Or file manually</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={mTitle} onChange={e => setMTitle(e.target.value)} placeholder="Title" style={{ ...input, flex: 2, minWidth: 160 }} />
            <input value={mAuthor} onChange={e => setMAuthor(e.target.value)} placeholder="Author" style={{ ...input, flex: 1, minWidth: 120 }} />
            <input value={mSeries} onChange={e => setMSeries(e.target.value)} placeholder="Series (optional)" style={{ ...input, flex: 1, minWidth: 120 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} style={{ ...input, cursor: 'pointer', color: 'var(--onyx-text-dim)' }}>Cancel</button>
            <button onClick={() => apply(mTitle, mAuthor, mSeries || null, null)} disabled={applying} style={{ ...input, cursor: 'pointer', color: 'var(--onyx-accent)', borderColor: 'var(--onyx-accent-edge)', background: 'var(--onyx-accent-dim)' }}>
              {applying ? 'Filing…' : 'File as entered'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
