import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import ReactDOM from 'react-dom';
// convertFileSrc turns the absolute disk path get_cover now returns into an
// asset:// URL WebView2 can load directly.
import { convertFileSrc } from '@tauri-apps/api/core';
import type { LibraryItem } from '../state/onyx';
import { bookAuthor } from '../state/onyx';
import { searchBooks, searchProviders, updateMedia, fetchItem, getCover, getCustomMetadataProviders } from '../api/abs';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO  = "'JetBrains Mono', ui-monospace, monospace";
const SANS  = "'Inter', system-ui, -apple-system, sans-serif";

/* Local design tokens for the match review screen — see design-handoff/metadata_match/shared.jsx */
const MATCH_ONYX = {
  bg: '#0b0b0e', bgDeep: '#08080b', panel: '#131319', panel2: '#1a1a22',
  line: 'rgba(255,255,255,0.06)', lineStrong: 'rgba(255,255,255,0.12)',
  text: '#ebe7df', textDim: 'rgba(235,231,223,0.62)', textMute: 'rgba(235,231,223,0.38)',
  accent: '#d4a64a', accentBright: '#e9bb5e', accentDeep: '#a37d2e',
  accentDim: 'rgba(212,166,74,0.18)', accentEdge: 'rgba(212,166,74,0.35)',
  glass: 'rgba(255,255,255,0.04)', glassStrong: 'rgba(255,255,255,0.07)', glassEdge: 'rgba(255,255,255,0.09)',
  add: '#5ac88a', addDim: 'rgba(90,200,138,0.14)', addEdge: 'rgba(90,200,138,0.32)',
  sans: '"Inter", -apple-system, system-ui, sans-serif',
  serif: '"Source Serif Pro", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, Menlo, monospace',
};

// Used only if the live GET /api/search/providers fetch fails or returns nothing.
const FALLBACK_PROVIDERS = [
  { id: 'audible',    name: 'Audible.com'  },
  { id: 'google',     name: 'Google Books' },
  { id: 'itunes',     name: 'iTunes'       },
  { id: 'openlibrary',name: 'Open Library' },
  { id: 'fantlab',    name: 'FantLab.ru'   },
];

/* Match modal local tokens — extends global Onyx theme */
const MX = {
  bg:          '#0b0b0e',
  panel2:      '#1a1a22',
  line:        'rgba(255,255,255,0.06)',
  lineStrong:  'rgba(255,255,255,0.12)',
  text:        '#ebe7df',
  textDim:     'rgba(235,231,223,0.62)',
  textMute:    'rgba(235,231,223,0.38)',
  accent:      '#d4a64a',
  accentDim:   'rgba(212,166,74,0.18)',
  accentEdge:  'rgba(212,166,74,0.35)',
  glass:       'rgba(255,255,255,0.04)',
  glassStrong: 'rgba(255,255,255,0.07)',
  glassEdge:   'rgba(255,255,255,0.09)',
  add:         '#5ac88a',
  addDim:      'rgba(90,200,138,0.14)',
  addEdge:     'rgba(90,200,138,0.32)',
};

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

type FieldType = 'text' | 'longtext' | 'mono' | 'chips' | 'cover';
type FieldStatus = 'same' | 'added' | 'changed';

interface MatchField {
  key: string;
  label: string;
  type: FieldType;
  current: unknown;
  incoming: unknown;
  status: FieldStatus;
}

// Normalise a series value to a display string.
// Search results use { series, sequence }; library metadata uses { name, sequence }.
function seriesStr(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((s: Record<string, string>) => {
    const name = s.series ?? s.name ?? '';
    return s.sequence ? `${name} #${s.sequence}` : name;
  }).join(', ');
}

// Normalize a value for comparison — arrays joined with null byte, strings trimmed.
function normVal(v: unknown): string {
  if (Array.isArray(v)) return v.join('\0');
  if (v == null) return '';
  return v.toString().trim();
}

function fieldStatus(f: Omit<MatchField, 'status'>): FieldStatus {
  if (f.type === 'cover') return 'changed';
  const c = normVal(f.current), i = normVal(f.incoming);
  if (c === i) return 'same';
  if (!c) return 'added';
  return 'changed';
}

// Parse "Series Name #Sequence" or "Series Name · Sequence" back into parts.
function splitSeries(s: string): { name: string; sequence: string } {
  const hashIdx = s.lastIndexOf('#');
  if (hashIdx > 0) return { name: s.slice(0, hashIdx).trim(), sequence: s.slice(hashIdx + 1).trim() };
  const dotIdx = s.lastIndexOf('·');
  if (dotIdx > 0) return { name: s.slice(0, dotIdx).trim(), sequence: s.slice(dotIdx + 1).trim() };
  return { name: s.trim(), sequence: '' };
}

// ── Option B atoms — see design-handoff/metadata_match ────────────────────────

/* Metadata Match Option B — see design-handoff/metadata_match */
function Glyph({ name, size = 16, color = 'currentColor', sw = 1.6 }: {
  name: string; size?: number; color?: string; sw?: number;
}) {
  const s: CSSProperties = { width: size, height: size, display: 'block', flexShrink: 0 };
  const p = { fill: 'none', stroke: color, strokeWidth: sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'close':   return <svg style={s} viewBox="0 0 16 16"><path d="M4 4 L12 12 M12 4 L4 12" {...p} /></svg>;
    case 'back':    return <svg style={s} viewBox="0 0 16 16"><path d="M9 3 L4 8 L9 13 M4 8 L13 8" {...p} /></svg>;
    case 'left':    return <svg style={s} viewBox="0 0 16 16"><path d="M10 3 L5 8 L10 13" {...p} strokeWidth={sw + 0.2} /></svg>;
    case 'right':   return <svg style={s} viewBox="0 0 16 16"><path d="M6 3 L11 8 L6 13" {...p} strokeWidth={sw + 0.2} /></svg>;
    case 'down':    return <svg style={s} viewBox="0 0 16 16"><path d="M3 6 L8 11 L13 6" {...p} /></svg>;
    case 'check':   return <svg style={s} viewBox="0 0 16 16"><path d="M3 8 L7 12 L13 4" {...p} strokeWidth={sw + 0.3} /></svg>;
    case 'arrow':   return <svg style={s} viewBox="0 0 16 16"><path d="M3 8 L13 8 M9 4 L13 8 L9 12" {...p} /></svg>;
    case 'revert':  return <svg style={s} viewBox="0 0 16 16"><path d="M6 3 L3 6 L6 9 M3 6 L11 6 Q13 6 13 9 L13 13" {...p} /></svg>;
    case 'edit':    return <svg style={s} viewBox="0 0 16 16"><path d="M11 2.5 L13.5 5 L6 12.5 L3 13 L3.5 10 Z" {...p} /></svg>;
    case 'sparkle': return <svg style={s} viewBox="0 0 16 16"><path d="M8 2 L9.2 6.2 L13 8 L9.2 9.8 L8 14 L6.8 9.8 L3 8 L6.8 6.2 Z" fill={color} stroke="none" /></svg>;
    case 'bolt':    return <svg style={s} viewBox="0 0 16 16"><path d="M9 2 L4 9 L7.5 9 L7 14 L12 7 L8.5 7 Z" fill={color} stroke="none" /></svg>;
    default: return null;
  }
}

/* Metadata Match Option B — see design-handoff/metadata_match */
function StatusTag({ status, style }: { status: string; style?: CSSProperties }) {
  const map: Record<string, { t: string; c: string; bg: string; e: string }> = {
    added:   { t: 'NEW',     c: MX.add,      bg: MX.addDim,     e: MX.addEdge   },
    changed: { t: 'CHANGED', c: MX.accent,   bg: MX.accentDim,  e: MX.accentEdge },
    edited:  { t: 'EDITED',  c: MX.text,     bg: MX.glassStrong, e: MX.lineStrong },
    same:    { t: 'MATCH',   c: MX.textMute, bg: 'transparent', e: MX.line      },
  };
  const m = map[status] ?? map.same;
  return (
    <span style={{
      fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.13em', color: m.c,
      background: m.bg, border: `1px solid ${m.e}`, borderRadius: 3,
      padding: '1.5px 5px', lineHeight: 1, whiteSpace: 'nowrap' as const, ...style,
    }}>{m.t}</span>
  );
}

/* Metadata Match Option B — see design-handoff/metadata_match */
function MatchCheck({ on, onClick, size = 17, accent = MX.accent }: {
  on: boolean; onClick: () => void; size?: number; accent?: string;
}) {
  return (
    <button onClick={onClick} aria-pressed={on} style={{
      width: size, height: size, borderRadius: 4, flexShrink: 0, cursor: 'pointer', padding: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: on ? accent : 'transparent',
      border: `1.5px solid ${on ? accent : MX.lineStrong}`,
      transition: 'background .12s, border-color .12s',
    }}>
      {on && <Glyph name="check" size={size * 0.62} color={MX.bg} sw={2} />}
    </button>
  );
}

/* Read-only field renderer — Option B design, see design-handoff/metadata_match/option-b.jsx */
function ValueCell({ field, side, value, dim, strike, currentCoverUrl, incomingCoverUrl }: {
  field: MatchField; side: 'current' | 'incoming'; value: unknown;
  dim?: boolean; strike?: boolean;
  currentCoverUrl?: string; incomingCoverUrl?: string;
}) {
  if (field.type === 'cover') {
    const url = side === 'current' ? currentCoverUrl : incomingCoverUrl;
    if (url) return <img src={url} alt="" width={46} height={46} style={{ borderRadius: 4, objectFit: 'cover' as const, flexShrink: 0 }} />;
    return <div style={{ width: 46, height: 46, borderRadius: 4, background: MATCH_ONYX.glassStrong, flexShrink: 0 }} />;
  }
  const empty = Array.isArray(value) ? value.length === 0 : !value;
  if (field.type === 'chips') {
    if (empty) return <span style={{ fontSize: 11, color: MATCH_ONYX.textMute, fontStyle: 'italic' }}>none</span>;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {(value as string[]).map((t, i) => (
          <span key={i} style={{
            fontSize: 10.5, padding: '2px 7px', borderRadius: 20,
            color: dim ? MATCH_ONYX.textMute : MATCH_ONYX.textDim, background: MATCH_ONYX.glass, border: `1px solid ${MATCH_ONYX.line}`,
          }}>{t}</span>
        ))}
      </div>
    );
  }
  if (empty) {
    return <span style={{ fontSize: 12, color: MATCH_ONYX.textMute, fontStyle: 'italic', fontFamily: MATCH_ONYX.sans }}>empty</span>;
  }
  const isLong = field.type === 'longtext';
  return (
    <span style={{
      fontSize: isLong ? 11.5 : 12.5, lineHeight: isLong ? 1.45 : 1.3,
      fontFamily: field.type === 'mono' ? MATCH_ONYX.mono : MATCH_ONYX.sans,
      color: dim ? MATCH_ONYX.textMute : MATCH_ONYX.textDim,
      textDecoration: strike ? 'line-through' : 'none',
      textDecorationColor: 'rgba(235,231,223,0.25)',
      display: '-webkit-box' as const, WebkitLineClamp: isLong ? 4 : 2,
      WebkitBoxOrient: 'vertical' as const, overflow: 'hidden',
    }}>{value as string}</span>
  );
}

/* Inline editor for the result cell — commits on Save/Enter, discards on Cancel/Esc */
function EditField({ field, value, onSave, onCancel }: {
  field: MatchField; value: unknown;
  onSave: (v: unknown) => void; onCancel: () => void;
}) {
  const initial = field.type === 'chips'
    ? (Array.isArray(value) ? value.join(', ') : String(value ?? ''))
    : String(value ?? '');
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) { ref.current.focus(); ref.current.select?.(); }
  }, []);
  const commit = () => {
    const out = field.type === 'chips'
      ? draft.split(',').map(s => s.trim()).filter(Boolean)
      : draft;
    onSave(out);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    else if (e.key === 'Enter' && (field.type !== 'longtext' || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
  };
  const inputStyle: CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: MATCH_ONYX.panel2,
    border: `1px solid ${MATCH_ONYX.accentEdge}`, borderRadius: 6, color: MATCH_ONYX.text,
    fontFamily: field.type === 'mono' ? MATCH_ONYX.mono : MATCH_ONYX.sans,
    fontSize: field.type === 'longtext' ? 11.5 : 12.5, lineHeight: 1.4,
    padding: '7px 9px', outline: 'none', resize: 'vertical' as const,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      {field.type === 'longtext' ? (
        <textarea ref={ref} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey} rows={4} style={inputStyle} />
      ) : (
        <input ref={ref} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey}
          style={inputStyle} placeholder={field.type === 'chips' ? 'comma, separated, tags' : ''} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={commit} style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6,
          border: 'none', cursor: 'pointer', background: MATCH_ONYX.accent, color: MATCH_ONYX.bg,
          fontFamily: MATCH_ONYX.mono, fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase' as const, fontWeight: 600,
        }}>
          <Glyph name="check" size={11} color={MATCH_ONYX.bg} sw={2} />Save
        </button>
        <button onClick={onCancel} style={{
          padding: '4px 10px', borderRadius: 6, border: `1px solid ${MATCH_ONYX.glassEdge}`,
          cursor: 'pointer', background: 'transparent', color: MATCH_ONYX.textDim,
          fontFamily: MATCH_ONYX.mono, fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase' as const,
        }}>Cancel</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: MATCH_ONYX.mono, fontSize: 8.5, color: MATCH_ONYX.textMute, letterSpacing: '0.04em' }}>
          {field.type === 'longtext' ? '⌘↵ save · esc' : '↵ save · esc'}
        </span>
      </div>
    </div>
  );
}

/* 4-column diff row — label | current | toggle | result — Option B layout */
function CompareRow({ field, base, resolved, edited, applied, editing,
                      onToggle, onStartEdit, onSaveEdit, onCancelEdit, onRevert,
                      currentCoverUrl, incomingCoverUrl }: {
  field: MatchField; base: 'incoming' | 'current' | undefined;
  resolved: unknown; edited: boolean; applied: boolean; editing: boolean;
  onToggle: () => void; onStartEdit: () => void;
  onSaveEdit: (v: unknown) => void; onCancelEdit: () => void; onRevert: () => void;
  currentCoverUrl?: string; incomingCoverUrl?: string;
}) {
  const changed = field.status !== 'same';
  const accent = field.status === 'added' ? MATCH_ONYX.add : MATCH_ONYX.accent;
  const tintBg = !applied ? 'transparent'
    : edited ? 'rgba(255,255,255,0.05)'
    : field.status === 'added' ? MATCH_ONYX.addDim : 'rgba(212,166,74,0.07)';
  const tintBar = edited ? MATCH_ONYX.textDim : accent;
  const canEdit = field.type !== 'cover';

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '78px 1fr 38px 1fr',
      alignItems: editing ? 'start' : 'center',
      borderBottom: `1px solid ${MATCH_ONYX.line}`, minHeight: 50,
    }}>
      {/* label + status tag */}
      <div style={{ padding: '12px 10px 12px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{
          fontFamily: MATCH_ONYX.mono, fontSize: 9, letterSpacing: '0.08em',
          textTransform: 'uppercase' as const, lineHeight: 1.2,
          color: (changed || edited) ? MATCH_ONYX.textDim : MATCH_ONYX.textMute,
        }}>{field.label}</span>
        {edited
          ? <StatusTag status="edited" style={{ alignSelf: 'flex-start' }} />
          : changed && <StatusTag status={field.status} style={{ alignSelf: 'flex-start' }} />}
      </div>
      {/* current value */}
      <div style={{ padding: '12px 14px', minWidth: 0 }}>
        <ValueCell field={field} side="current" value={field.current}
          dim strike={applied} currentCoverUrl={currentCoverUrl} incomingCoverUrl={incomingCoverUrl} />
      </div>
      {/* accept toggle / revert button */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', paddingTop: editing ? 12 : 0 }}>
        {edited ? (
          <button onClick={onRevert} title="Revert to source value" style={{
            width: 26, height: 26, borderRadius: 13, cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: `1.5px solid ${MATCH_ONYX.lineStrong}`,
          }}>
            <Glyph name="revert" size={13} color={MATCH_ONYX.textDim} />
          </button>
        ) : changed ? (
          <button onClick={onToggle}
            title={base === 'incoming' ? 'Using new value' : 'Keeping current'}
            style={{
              width: 26, height: 26, borderRadius: 13, cursor: 'pointer', padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: base === 'incoming' ? accent : 'transparent',
              border: `1.5px solid ${base === 'incoming' ? accent : MATCH_ONYX.lineStrong}`,
              transition: 'all .12s',
            }}>
            <Glyph name={base === 'incoming' ? 'check' : 'right'} size={13}
              color={base === 'incoming' ? MATCH_ONYX.bg : MATCH_ONYX.textMute} sw={2} />
          </button>
        ) : (
          <Glyph name="check" size={12} color={MATCH_ONYX.textMute} />
        )}
      </div>
      {/* result cell — read or edit mode */}
      <div style={{
        padding: editing ? '10px 16px 12px 14px' : '12px 16px 12px 14px', minWidth: 0,
        alignSelf: 'stretch', display: 'flex', alignItems: editing ? 'stretch' : 'center', gap: 8,
        background: editing ? 'transparent' : tintBg,
        boxShadow: (!editing && applied) ? `inset 2px 0 0 ${tintBar}` : 'none',
      }}>
        {editing ? (
          <EditField field={field} value={resolved} onSave={onSaveEdit} onCancel={onCancelEdit} />
        ) : (
          <>
            <div style={{ minWidth: 0, flex: 1 }}>
              <ValueCell field={field} side="incoming" value={resolved}
                dim={!applied && !edited} currentCoverUrl={currentCoverUrl} incomingCoverUrl={incomingCoverUrl} />
            </div>
            {canEdit && (
              <button onClick={onStartEdit} title={`Edit ${field.label}`} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 3, marginRight: -3,
                display: 'flex', color: MATCH_ONYX.textMute, flexShrink: 0, alignSelf: 'flex-start',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = MATCH_ONYX.accent; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = MATCH_ONYX.textMute; }}
              >
                <Glyph name="edit" size={13} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Confidence badge for search results ───────────────────────────────────────

function ConfBadge({ score }: { score?: number }) {
  if (score == null) return null;
  const color = score >= 90 ? 'var(--onyx-accent)' : score >= 70 ? '#e8b74a' : 'var(--onyx-text-mute)';
  return (
    <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em', color, border: `1px solid ${color}`, borderRadius: 4, padding: '1px 5px' }}>
      {score}%
    </span>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MatchModalProps {
  item: LibraryItem;
  serverUrl: string;

  onClose: () => void;
  onComplete: (updatedItem: LibraryItem) => void;
  onRefresh: () => void;
}

// ── MatchModal ────────────────────────────────────────────────────────────────

export default function MatchModal({ item, serverUrl, onClose, onComplete, onRefresh }: MatchModalProps) {
  const meta = item.media.metadata;

  // ── Search screen state ───────────────────────────────────────────────────
  const [provider, setProvider]       = useState('audible');
  // Holds the list of metadata providers fetched from the server
  const [providers, setProviders]     = useState<{ id: string; name: string }[]>([]);
  const [queryTitle, setQueryTitle]   = useState(meta.title ?? '');
  const [queryAuthor, setQueryAuthor] = useState(bookAuthor(item));
  const [searching, setSearching]     = useState(false);
  const [searchErr, setSearchErr]     = useState<string | null>(null);
  const [results, setResults]         = useState<SearchResult[]>([]);
  const [selected, setSelected]       = useState<SearchResult | null>(null);
  const [screen, setScreen]           = useState<'search' | 'review'>('search');
  const [submitting, setSubmitting]   = useState(false);
  const [currentCoverUrl, setCurrentCoverUrl] = useState<string | null>(null);

  // Fetch the current item's cover (same pattern as Cover.tsx). get_cover now
  // returns an absolute file path, so convert it to an asset:// URL here — the
  // shared ValueCell <img> renders this directly alongside remote incoming
  // cover URLs, which must stay untouched.
  useEffect(() => {
    let cancelled = false;
    getCover(serverUrl, item.id)
      .then(path => {
        if (cancelled) return;
        setCurrentCoverUrl(convertFileSrc(path));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [serverUrl, item.id]);

  // Fetch the live provider list from GET /api/search/providers (Bearer-
  // authenticated via the existing invoke wrapper). The endpoint returns
  // { providers: { books: [{ value, text }], booksCovers: [...], podcasts: [...] } } —
  // see SearchController.js getAllProviders. Match is a book-search flow, so we
  // read the "books" array and map { value, text } to the { id, name } shape used
  // here. Falls back to a minimal hardcoded list on failure or an empty response.
  useEffect(() => {
    let cancelled = false;
    // Fetch built-in providers and registered custom providers in parallel and
    // merge them so custom providers are selectable when matching.
    Promise.all([
      searchProviders(serverUrl).catch(() => null),
      getCustomMetadataProviders(serverUrl).catch(() => []),
    ]).then(([raw, custom]) => {
      if (cancelled) return;
      const books = (((raw as Record<string, unknown>)?.providers as Record<string, unknown>)
        ?.books as { value: string; text: string }[] | undefined) ?? [];
      const builtins = books.map(p => ({ id: p.value, name: p.text }));
      const base = builtins.length > 0 ? builtins : FALLBACK_PROVIDERS;
      const customBook = (custom ?? [])
        .filter(p => p.mediaType === 'book')
        .map(p => ({ id: p.slug, name: `${p.name} (custom)` }));
      const list = [...base, ...customBook];
      setProviders(list);
      setProvider(p => list.some(x => x.id === p) ? p : (list[0]?.id ?? 'audible'));
    });
    return () => { cancelled = true; };
  }, [serverUrl]);

  // ── Option B review state (replaces checked / editedValues) ───────────────
  const [base, setBase]               = useState<Record<string, 'incoming' | 'current'>>({});
  const [edits, setEdits]             = useState<Record<string, unknown>>({});
  const [editingKey, setEditingKey]   = useState<string | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(true);

  /* Maps live item + search result into Option B field shape */
  const buildFields = (src: SearchResult): MatchField[] => {
    const m = item.media?.metadata;
    const raw: Omit<MatchField, 'status'>[] = [
      { key: 'cover',       label: 'Cover',       type: 'cover',    current: null,                        incoming: src.cover ?? null },
      { key: 'title',       label: 'Title',       type: 'text',     current: m?.title ?? '',               incoming: src.title ?? '' },
      { key: 'subtitle',    label: 'Subtitle',    type: 'text',     current: m?.subtitle ?? '',            incoming: src.subtitle ?? '' },
      { key: 'author',      label: 'Author',      type: 'text',     current: m?.authorName ?? '',          incoming: src.author ?? '' },
      { key: 'narrator',    label: 'Narrator',    type: 'text',     current: m?.narratorName ?? '',        incoming: src.narrator ?? '' },
      { key: 'series',      label: 'Series',      type: 'text',     current: m?.seriesName ?? '',          incoming: seriesStr(src.series) },
      { key: 'publisher',   label: 'Publisher',   type: 'text',     current: m?.publisher ?? '',           incoming: src.publisher ?? '' },
      { key: 'year',        label: 'Year',        type: 'text',     current: m?.publishedYear ?? '',       incoming: src.publishedYear ?? '' },
      { key: 'genres',      label: 'Genres',      type: 'chips',    current: m?.genres ?? [],              incoming: src.genres ?? [] },
      { key: 'tags',        label: 'Tags',        type: 'chips',    current: item.media?.tags ?? [],       incoming: src.tags ?? [] },
      { key: 'language',    label: 'Language',    type: 'text',     current: m?.language ?? '',            incoming: src.language ?? '' },
      { key: 'isbn',        label: 'ISBN',        type: 'mono',     current: m?.isbn ?? '',                incoming: src.isbn ?? '' },
      { key: 'asin',        label: 'ASIN',        type: 'mono',     current: '',                           incoming: src.asin ?? '' },
      { key: 'description', label: 'Description', type: 'longtext', current: m?.description ?? '',         incoming: src.description ?? '' },
    ];
    return raw.map(f => ({ ...f, status: fieldStatus(f) }));
  };

  // ── Field definitions — derived from item + selected ─────────────────────
  const fields = useMemo((): MatchField[] => {
    if (!selected) return [];
    return buildFields(selected);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const changedFields = useMemo(() => fields.filter(f => f.status !== 'same'), [fields]);
  const sameFields    = useMemo(() => fields.filter(f => f.status === 'same'),  [fields]);

  // Initialize base whenever a new result is selected.
  useEffect(() => {
    if (!selected) return;
    const fs = buildFields(selected);
    setBase(Object.fromEntries(
      fs.filter(f => f.status !== 'same').map(f => [f.key, 'incoming' as const])
    ));
    setEdits({});
    setEditingKey(null);
    setOnlyChanges(true);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Option B helpers ──────────────────────────────────────────────────────
  // Resolve the value that will be saved for a field — edits take priority over base toggle
  const resolveField = (f: MatchField): unknown => {
    if (edits[f.key] !== undefined) return edits[f.key];
    if (f.status === 'same') return f.current;
    return base[f.key] === 'incoming' ? f.incoming : f.current;
  };
  const isEdited  = (f: MatchField) => edits[f.key] !== undefined && normVal(edits[f.key]) !== normVal(f.incoming);
  const isApplied = (f: MatchField) => normVal(resolveField(f)) !== normVal(f.current);

  const toggle   = (k: string) => setBase(b => ({ ...b, [k]: b[k] === 'incoming' ? 'current' : 'incoming' }));
  const saveEdit = (k: string, v: unknown) => { setEdits(e => ({ ...e, [k]: v })); setEditingKey(null); };
  const revert   = (k: string) => setEdits(e => { const n = { ...e }; delete n[k]; return n; });

  const visible      = onlyChanges ? changedFields : fields;
  const appliedCount = fields.filter(isApplied).length;
  const editedCount  = fields.filter(isEdited).length;
  const allOn        = changedFields.length > 0 && changedFields.every(f => base[f.key] === 'incoming' && edits[f.key] === undefined);

  const acceptAll = () => {
    if (allOn) {
      setBase(Object.fromEntries(changedFields.map(f => [f.key, 'current' as const])));
    } else {
      setBase(Object.fromEntries(changedFields.map(f => [f.key, 'incoming' as const])));
      setEdits({}); setEditingKey(null);
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSearch = useCallback(async () => {
    setSearching(true); setSearchErr(null);
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
    setOnlyChanges(true);
    setScreen('review');
    // base/edits reset handled by the useEffect on [fields]
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      /* Builds metadata patch from Option B resolved field values. Tags live at
         the top level of the media payload (ABS reads mediaPayload.tags, not
         metadata.tags), so they're collected separately. */
      const metadata: Record<string, unknown> = {};
      let tags: string[] | undefined;
      for (const f of fields) {
        if (f.key === 'cover') continue; // cover update requires separate endpoint
        if (!isApplied(f)) continue;
        const val = resolveField(f);
        switch (f.key) {
          case 'title':       metadata.title         = val; break;
          case 'subtitle':    metadata.subtitle      = val; break;
          case 'author':      metadata.authors       = String(val).split(',').map(n => ({ name: n.trim() })).filter(o => o.name); break;
          case 'narrator':    metadata.narrators     = String(val).split(',').map(n => n.trim()).filter(Boolean); break;
          case 'publisher':   metadata.publisher     = val; break;
          case 'year':        metadata.publishedYear = val; break;
          case 'series': {
            const { name, sequence } = splitSeries(String(val));
            metadata.series = [{ name, sequence }]; break;
          }
          case 'genres':      metadata.genres        = Array.isArray(val) ? val : String(val).split(',').map(g => g.trim()).filter(Boolean); break;
          case 'tags':        tags                   = Array.isArray(val) ? val : String(val).split(',').map(t => t.trim()).filter(Boolean); break;
          case 'language':    metadata.language      = val; break;
          case 'isbn':        metadata.isbn          = val; break;
          case 'asin':        metadata.asin          = val; break;
          case 'description': metadata.description   = val; break;
        }
      }
      await updateMedia(serverUrl, item.id, tags ? { metadata, tags } : { metadata });
      const updated = await fetchItem(serverUrl, item.id);
      onComplete(updated);
      onRefresh();
    } catch (e) {
      console.error('[MatchModal] submit failed:', e);
    } finally {
      setSubmitting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, item.id, selected, fields, base, edits, onComplete, onRefresh]);

  // ── Style constants ───────────────────────────────────────────────────────
  const inputStyle: CSSProperties = {
    padding: '8px 12px', background: 'rgba(0,0,0,0.35)', borderRadius: 8,
    color: 'var(--onyx-text)', border: '1px solid var(--onyx-glass-edge)',
    outline: 'none', fontFamily: 'inherit', fontSize: 13,
  };
  const labelStyle: CSSProperties = {
    fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginBottom: 5,
  };

  const providerLabel = providers.find(p => p.id === provider)?.name ?? provider;
  const providersLoading = providers.length === 0;

  // ── Modal JSX ─────────────────────────────────────────────────────────────
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
        width: '100%', maxWidth: 720, maxHeight: '90vh',
        background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-line)',
        borderRadius: 14, boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* ── Search screen header (only when in search mode) ─────────── */}
        {screen === 'search' && (
          <div style={{ padding: '18px 24px 16px', borderBottom: '1px solid var(--onyx-line)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500 }}>Match Book</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--onyx-text-mute)', fontSize: 18, lineHeight: 1, padding: 4, flexShrink: 0 }}>✕</button>
          </div>
        )}

        {/* ── Search screen ──────────────────────────────────────────────── */}
        {screen === 'search' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--onyx-line)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', flexShrink: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 140 }}>
                <div style={labelStyle}>Provider</div>
                <select value={provider} onChange={e => setProvider(e.target.value)} disabled={providersLoading}
                  style={{ ...inputStyle, cursor: providersLoading ? 'default' : 'pointer', opacity: providersLoading ? 0.6 : 1 }}>
                  {providersLoading
                    ? <option value={provider}>Loading…</option>
                    : providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 160 }}>
                <div style={labelStyle}>Title / ASIN</div>
                <input value={queryTitle} onChange={e => setQueryTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} placeholder="Title or ASIN…" style={{ ...inputStyle }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 140 }}>
                <div style={labelStyle}>Author</div>
                <input value={queryAuthor} onChange={e => setQueryAuthor(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} placeholder="Author…" style={{ ...inputStyle }} />
              </div>
              <button onClick={handleSearch} disabled={searching} style={{ padding: '8px 20px', borderRadius: 8, cursor: searching ? 'default' : 'pointer', background: 'var(--onyx-accent)', border: 'none', color: 'var(--onyx-bg)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', fontWeight: 600, opacity: searching ? 0.6 : 1 }}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {searchErr && <div style={{ padding: '24px', color: '#e87c7c', fontFamily: MONO, fontSize: 11 }}>{searchErr}</div>}
              {!searching && !searchErr && results.length === 0 && (
                <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em' }}>
                  {queryTitle ? 'No results found.' : 'Enter a title and click Search.'}
                </div>
              )}
              {results.map((r, i) => (
                <button key={i} onClick={() => handleSelect(r)}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 14, width: '100%', padding: '12px 24px', background: 'none', border: 'none', borderBottom: '1px solid var(--onyx-line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  {r.cover
                    ? <img src={r.cover} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                    : <div style={{ width: 48, height: 48, borderRadius: 4, background: 'var(--onyx-glass)', flexShrink: 0 }} />
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: SERIF, fontSize: 14.5, fontWeight: 500, color: 'var(--onyx-text)' }}>{r.title}</span>
                      {r.publishedYear && <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)' }}>{r.publishedYear}</span>}
                      <ConfBadge score={r.confidence} />
                    </div>
                    {r.author   && <div style={{ marginTop: 2, fontSize: 12.5, color: 'var(--onyx-text-dim)' }}>{r.author}</div>}
                    {r.narrator && <div style={{ marginTop: 1, fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>Narr. {r.narrator}</div>}
                    {r.series   && <div style={{ marginTop: 1, fontFamily: MONO, fontSize: 10, color: 'var(--onyx-accent)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{seriesStr(r.series)}</div>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Review screen — Option B side-by-side diff ─────────────────── */}
        {screen === 'review' && selected && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: MATCH_ONYX.bg }}>

            {/* Header */}
            <div style={{ position: 'relative', padding: '16px 18px 0', borderBottom: `1px solid ${MX.line}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingBottom: 14 }}>
                {/* Back */}
                <button onClick={() => setScreen('search')} title="Back to search"
                  style={{ background: 'none', border: 'none', color: MX.textDim, cursor: 'pointer', padding: 4, marginLeft: -4, display: 'flex', flexShrink: 0 }}>
                  <Glyph name="back" size={17} />
                </button>
                {/* Title block */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: MATCH_ONYX.serif, fontSize: 19, fontWeight: 600, lineHeight: 1.1 }}>Review Match</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: MX.textMute, marginTop: 5, letterSpacing: '0.04em' }}>
                    {providerLabel}
                    {selected.confidence != null && ` · ${Math.round(selected.confidence * 100)}% match`}
                    {` · ${changedFields.length} differ · edit any field`}
                  </div>
                </div>
                {/* Segmented filter */}
                <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 3, border: `1px solid ${MX.line}`, flexShrink: 0 }}>
                  {(['Changes', 'All fields'] as const).map((lbl, idx) => {
                    const v = idx === 0;
                    return (
                      <button key={lbl} onClick={() => setOnlyChanges(v)} style={{
                        padding: '5px 11px', borderRadius: 6, border: 'none', cursor: 'pointer',
                        fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase' as const,
                        background: onlyChanges === v ? MX.accentDim : 'transparent',
                        color: onlyChanges === v ? MX.accent : MX.textMute, transition: 'all .12s',
                      }}>{lbl}</button>
                    );
                  })}
                </div>
                {/* Close */}
                <button onClick={onClose} title="Close"
                  style={{ background: 'none', border: 'none', color: MX.textDim, cursor: 'pointer', padding: 4, marginRight: -4, display: 'flex', flexShrink: 0 }}>
                  <Glyph name="close" size={16} />
                </button>
              </div>
              {/* Column heads */}
              <div style={{ display: 'grid', gridTemplateColumns: '78px 1fr 38px 1fr', alignItems: 'center' }}>
                <span />
                <span style={{ padding: '8px 14px', fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', color: MX.textMute }}>CURRENT</span>
                <span />
                <span style={{ padding: '8px 16px', fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', color: MX.accent, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Glyph name="sparkle" size={9} color={MX.accent} />RESULT
                  <span style={{ color: MX.textMute, letterSpacing: '0.04em' }}>· editable</span>
                </span>
              </div>
            </div>

            {/* Rows */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {visible.map(f => (
                <CompareRow
                  key={f.key} field={f}
                  base={base[f.key] as 'incoming' | 'current' | undefined}
                  resolved={resolveField(f)} edited={isEdited(f)} applied={isApplied(f)}
                  editing={editingKey === f.key}
                  onToggle={() => toggle(f.key)}
                  onStartEdit={() => setEditingKey(f.key)}
                  onSaveEdit={v => saveEdit(f.key, v)}
                  onCancelEdit={() => setEditingKey(null)}
                  onRevert={() => revert(f.key)}
                  currentCoverUrl={currentCoverUrl ?? undefined}
                  incomingCoverUrl={selected.cover}
                />
              ))}
              {/* "N more match" footer strip — only in Changes mode */}
              {onlyChanges && sameFields.length > 0 && (
                <div style={{ padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Glyph name="check" size={12} color={MX.textMute} />
                  <span style={{ fontFamily: MONO, fontSize: 10, color: MX.textMute, letterSpacing: '0.05em' }}>
                    {sameFields.length} more field{sameFields.length === 1 ? '' : 's'} already match
                  </span>
                  <button onClick={() => setOnlyChanges(false)} style={{
                    background: 'none', border: 'none', color: MX.accent, cursor: 'pointer',
                    fontFamily: MONO, fontSize: 10, letterSpacing: '0.05em', padding: 0,
                  }}>show all</button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '12px 18px', borderTop: `1px solid ${MX.line}`,
              display: 'flex', alignItems: 'center', gap: 12,
              background: 'rgba(8,8,11,0.6)', flexShrink: 0,
            }}>
              {/* Accept all */}
              <div onClick={acceptAll} style={{
                display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                color: allOn ? MX.accent : MX.textDim,
              }}>
                <MatchCheck on={allOn} onClick={() => {}} size={15} /> Accept all
              </div>
              <span style={{ flex: 1 }} />
              {/* Change count */}
              <span style={{ fontSize: 11.5, color: MX.textMute }}>
                <strong style={{ color: MX.text, fontWeight: 600 }}>{appliedCount}</strong> change{appliedCount === 1 ? '' : 's'}
                {editedCount > 0 && <span style={{ color: MX.textMute }}> · {editedCount} edited</span>}
              </span>
              {/* Cancel */}
              <button onClick={onClose} style={{
                padding: '9px 18px', borderRadius: 8, background: 'transparent',
                border: `1px solid ${MX.glassEdge}`, color: MX.textDim, cursor: 'pointer',
                fontFamily: SANS, fontSize: 13,
              }}>Cancel</button>
              {/* Apply */}
              <button onClick={handleSubmit} disabled={submitting || appliedCount === 0} style={{
                padding: '9px 18px', borderRadius: 8, border: 'none',
                cursor: (submitting || appliedCount === 0) ? 'default' : 'pointer',
                background: appliedCount > 0 ? MX.accent : MX.glassStrong,
                color: appliedCount > 0 ? MX.bg : MX.textMute,
                fontFamily: SANS, fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 7,
              }}>
                <Glyph name="check" size={14} color={appliedCount > 0 ? MX.bg : MX.textMute} sw={2} />
                {submitting ? 'Applying…' : `Apply ${appliedCount}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
