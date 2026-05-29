import { useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import type { LibraryItem } from '../state/onyx';
import { bookAuthor } from '../state/onyx';
import { searchBooks, matchItem as matchItemCmd, fetchItem } from '../api/abs';
import Cover from './Cover';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO  = "'JetBrains Mono', ui-monospace, monospace";

const PROVIDERS = [
  { label: 'Audible.com',  value: 'audible'      },
  { label: 'Google Books', value: 'google'        },
  { label: 'iTunes',       value: 'itunes'        },
  { label: 'Open Library', value: 'openlibrary'   },
  { label: 'FantLab.ru',   value: 'fantlab'       },
];

interface SearchResult {
  title?: string;
  subtitle?: string;
  author?: string;
  narrator?: string;
  publisher?: string;
  publishedYear?: string;
  description?: string;
  cover?: string;
  series?: string | { name?: string; sequence?: string }[];
  genres?: string[];
  tags?: string[];
  language?: string;
  isbn?: string;
  asin?: string;
  confidence?: number;
}

function seriesStr(s: SearchResult['series']): string {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s.map(x => [x.name, x.sequence].filter(Boolean).join(' #')).join(', ');
}

function ConfBadge({ score }: { score?: number }) {
  if (score == null) return null;
  const color = score >= 90 ? 'var(--onyx-accent)' : score >= 70 ? '#e8b74a' : 'var(--onyx-text-mute)';
  return (
    <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em', color, border: `1px solid ${color}`, borderRadius: 4, padding: '1px 5px' }}>
      {score}%
    </span>
  );
}

export interface MatchModalProps {
  item: LibraryItem;
  serverUrl: string;
  onClose: () => void;
  onComplete: (updatedItem: LibraryItem) => void;
}

export default function MatchModal({ item, serverUrl, onClose, onComplete }: MatchModalProps) {
  const meta = item.media.metadata;

  const [provider, setProvider]     = useState('audible');
  const [queryTitle, setQueryTitle] = useState(meta.title ?? '');
  const [queryAuthor, setQueryAuthor] = useState(bookAuthor(item));
  const [searching, setSearching]   = useState(false);
  const [searchErr, setSearchErr]   = useState<string | null>(null);
  const [results, setResults]       = useState<SearchResult[]>([]);
  const [selected, setSelected]     = useState<SearchResult | null>(null);
  const [screen, setScreen]         = useState<'search' | 'review'>('search');
  const [submitting, setSubmitting] = useState(false);
  const [checked, setChecked]       = useState<Record<string, boolean>>({});

  const handleSearch = useCallback(async () => {
    setSearching(true);
    setSearchErr(null);
    try {
      const raw = await searchBooks(serverUrl, queryTitle, queryAuthor, provider);
      const arr = Array.isArray(raw)
        ? raw
        : ((raw as Record<string, unknown>)?.results as SearchResult[] ?? []);
      setResults(arr as SearchResult[]);
    } catch (e) {
      setSearchErr(String(e));
    } finally {
      setSearching(false);
    }
  }, [serverUrl, queryTitle, queryAuthor, provider]);

  const handleSelect = useCallback((result: SearchResult) => {
    setSelected(result);
    // Default-check fields that differ from the current item.
    const cur = item.media.metadata;
    const differs = (newVal: string | undefined, curVal: string | undefined | null) =>
      !!newVal && newVal !== (curVal ?? '');
    setChecked({
      cover:       !!(result.cover),
      title:       differs(result.title,       cur.title ?? ''),
      subtitle:    differs(result.subtitle,    cur.subtitle ?? ''),
      author:      differs(result.author,      bookAuthor(item)),
      narrator:    differs(result.narrator,    cur.narratorName ?? ''),
      publisher:   differs(result.publisher,   cur.publisher ?? ''),
      year:        differs(result.publishedYear, cur.publishedYear ?? ''),
      series:      differs(seriesStr(result.series), cur.seriesName ?? ''),
      genres:      !!(result.genres?.length),
      language:    differs(result.language,    cur.language ?? ''),
      isbn:        differs(result.isbn,        cur.isbn ?? cur.isbn13 ?? cur.isbn10 ?? ''),
      asin:        !!(result.asin),
    });
    setScreen('review');
  }, [item]);

  const handleSubmit = useCallback(async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      await matchItemCmd(serverUrl, item.id, provider, selected.title ?? '', selected.author ?? '', selected.asin);
      const updated = await fetchItem(serverUrl, item.id);
      onComplete(updated);
    } catch (e) {
      console.error('[MatchModal] submit failed:', e);
    } finally {
      setSubmitting(false);
    }
  }, [serverUrl, item.id, provider, selected, onComplete]);

  const toggleCheck = (key: string) => setChecked(c => ({ ...c, [key]: !c[key] }));

  const inputStyle = {
    padding: '8px 12px', background: 'rgba(0,0,0,0.35)', borderRadius: 8,
    color: 'var(--onyx-text)', border: '1px solid var(--onyx-glass-edge)',
    outline: 'none', fontFamily: 'inherit', fontSize: 13,
  };
  const labelStyle = {
    fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em',
    textTransform: 'uppercase' as const, color: 'var(--onyx-text-mute)',
    marginBottom: 5,
  };

  const modal = (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        width: '100%', maxWidth: 860, maxHeight: '90vh',
        background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-line)',
        borderRadius: 14, boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* ── Header ─────────────────────────────────────────────── */}
        <div style={{ padding: '18px 24px 16px', borderBottom: '1px solid var(--onyx-line)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {screen === 'review' && (
            <button onClick={() => setScreen('search')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--onyx-text-dim)', padding: '4px 8px 4px 0', fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 5 }}>
              ← Back
            </button>
          )}
          <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500, flex: 1 }}>
            {screen === 'search' ? 'Match Book' : 'Review Match'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--onyx-text-mute)', fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        {/* ── Search screen ──────────────────────────────────────── */}
        {screen === 'search' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Form */}
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--onyx-line)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', flexShrink: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 140 }}>
                <div style={labelStyle}>Provider</div>
                <select
                  value={provider}
                  onChange={e => setProvider(e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  {PROVIDERS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 160 }}>
                <div style={labelStyle}>Title / ASIN</div>
                <input
                  value={queryTitle}
                  onChange={e => setQueryTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Title or ASIN…"
                  style={{ ...inputStyle }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 140 }}>
                <div style={labelStyle}>Author</div>
                <input
                  value={queryAuthor}
                  onChange={e => setQueryAuthor(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Author…"
                  style={{ ...inputStyle }}
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={searching}
                style={{
                  padding: '8px 20px', borderRadius: 8, cursor: searching ? 'default' : 'pointer',
                  background: 'var(--onyx-accent)', border: 'none',
                  color: 'var(--onyx-bg)', fontFamily: MONO, fontSize: 11,
                  letterSpacing: '0.06em', fontWeight: 600,
                  opacity: searching ? 0.6 : 1,
                }}
              >
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {searchErr && (
                <div style={{ padding: '24px', color: '#e87c7c', fontFamily: MONO, fontSize: 11 }}>{searchErr}</div>
              )}
              {!searching && !searchErr && results.length === 0 && (
                <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em' }}>
                  {results.length === 0 && queryTitle ? 'No results found.' : 'Enter a title and click Search.'}
                </div>
              )}
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => handleSelect(r)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 14, width: '100%',
                    padding: '12px 24px', background: 'none', border: 'none',
                    borderBottom: '1px solid var(--onyx-line)', cursor: 'pointer',
                    textAlign: 'left', fontFamily: 'inherit', color: 'inherit',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  {/* Thumbnail */}
                  {r.cover ? (
                    <img src={r.cover} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 48, height: 48, borderRadius: 4, background: 'var(--onyx-glass)', flexShrink: 0 }} />
                  )}
                  {/* Text */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: SERIF, fontSize: 14.5, fontWeight: 500, color: 'var(--onyx-text)' }}>{r.title}</span>
                      {r.publishedYear && <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)' }}>{r.publishedYear}</span>}
                      <ConfBadge score={r.confidence} />
                    </div>
                    {r.author && <div style={{ marginTop: 2, fontSize: 12.5, color: 'var(--onyx-text-dim)' }}>{r.author}</div>}
                    {r.narrator && <div style={{ marginTop: 1, fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>Narr. {r.narrator}</div>}
                    {r.series && <div style={{ marginTop: 1, fontFamily: MONO, fontSize: 10, color: 'var(--onyx-accent)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{seriesStr(r.series)}</div>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Review screen ──────────────────────────────────────── */}
        {screen === 'review' && selected && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {/* Column headers */}
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 32px 1fr', gap: 0, padding: '8px 24px 6px', borderBottom: '1px solid var(--onyx-line)' }}>
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>Field</div>
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-accent)' }}>New Value</div>
                <div />
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>Current</div>
              </div>

              {/* Cover row */}
              {selected.cover && (
                <CompareRow label="Cover" checked={checked.cover ?? false} onToggle={() => toggleCheck('cover')}>
                  <img src={selected.cover} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4 }} />
                  <Cover item={item} size={56} serverUrl={serverUrl} />
                </CompareRow>
              )}
              <TextField label="Title"     newVal={selected.title}         curVal={meta.title ?? ''}          checked={checked.title}     onToggle={() => toggleCheck('title')} />
              <TextField label="Subtitle"  newVal={selected.subtitle}      curVal={meta.subtitle ?? ''}       checked={checked.subtitle}  onToggle={() => toggleCheck('subtitle')} />
              <TextField label="Author"    newVal={selected.author}        curVal={bookAuthor(item)}           checked={checked.author}    onToggle={() => toggleCheck('author')} />
              <TextField label="Narrator"  newVal={selected.narrator}      curVal={meta.narratorName ?? ''}   checked={checked.narrator}  onToggle={() => toggleCheck('narrator')} />
              <TextField label="Publisher" newVal={selected.publisher}     curVal={meta.publisher ?? ''}      checked={checked.publisher} onToggle={() => toggleCheck('publisher')} />
              <TextField label="Year"      newVal={selected.publishedYear} curVal={meta.publishedYear ?? ''}  checked={checked.year}      onToggle={() => toggleCheck('year')} />
              <TextField label="Series"    newVal={seriesStr(selected.series)} curVal={meta.seriesName ?? ''} checked={checked.series}    onToggle={() => toggleCheck('series')} />
              <TextField label="Genres"    newVal={(selected.genres ?? []).join(', ')} curVal={(meta.genres ?? []).join(', ')} checked={checked.genres} onToggle={() => toggleCheck('genres')} />
              <TextField label="Language"  newVal={selected.language}      curVal={meta.language ?? ''}       checked={checked.language}  onToggle={() => toggleCheck('language')} />
              <TextField label="ISBN"      newVal={selected.isbn}          curVal={meta.isbn13 ?? meta.isbn10 ?? meta.isbn ?? ''} checked={checked.isbn} onToggle={() => toggleCheck('isbn')} />
              {selected.asin && <TextField label="ASIN" newVal={selected.asin} curVal="" checked={checked.asin} onToggle={() => toggleCheck('asin')} />}
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--onyx-line)', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
              <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, background: 'transparent', border: '1px solid var(--onyx-glass-edge)', color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 11, cursor: 'pointer', letterSpacing: '0.06em' }}>
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  padding: '8px 22px', borderRadius: 8, cursor: submitting ? 'default' : 'pointer',
                  background: 'var(--onyx-accent)', border: 'none',
                  color: 'var(--onyx-bg)', fontFamily: MONO, fontSize: 11,
                  letterSpacing: '0.06em', fontWeight: 600, opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? 'Applying…' : 'Apply Match'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}

function CompareRow({
  label, checked, onToggle, children,
}: {
  label: string; checked: boolean; onToggle: () => void; children: [React.ReactNode, React.ReactNode];
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 32px 1fr', gap: 0, padding: '10px 24px', borderBottom: '1px solid var(--onyx-line)', alignItems: 'center' }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>{label}</div>
      <div style={{ fontSize: 13, color: checked ? 'var(--onyx-text)' : 'var(--onyx-text-mute)' }}>{children[0]}</div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <input type="checkbox" checked={checked} onChange={onToggle} style={{ accentColor: 'var(--onyx-accent)', width: 14, height: 14, cursor: 'pointer' }} />
      </div>
      <div style={{ fontSize: 13, color: 'var(--onyx-text-mute)' }}>{children[1]}</div>
    </div>
  );
}

function TextField({ label, newVal, curVal, checked, onToggle }: { label: string; newVal?: string; curVal: string; checked?: boolean; onToggle: () => void }) {
  if (!newVal && !curVal) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 32px 1fr', gap: 0, padding: '9px 24px', borderBottom: '1px solid var(--onyx-line)', alignItems: 'start' }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', paddingTop: 2 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: checked ? 'var(--onyx-text)' : 'var(--onyx-text-mute)', lineHeight: 1.4, paddingRight: 8 }}>{newVal || '—'}</div>
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 2 }}>
        <input type="checkbox" checked={!!checked} onChange={onToggle} style={{ accentColor: 'var(--onyx-accent)', width: 14, height: 14, cursor: 'pointer' }} />
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--onyx-text-mute)', lineHeight: 1.4 }}>{curVal || '—'}</div>
    </div>
  );
}
