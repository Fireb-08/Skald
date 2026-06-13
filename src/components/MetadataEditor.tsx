import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import ReactDOM from 'react-dom';
import type { LibraryItem } from '../state/onyx';
import { bookAuthor, bookNarrator } from '../state/onyx';
import { updateMedia, updateChapters, fetchItem } from '../api/abs';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO  = "'JetBrains Mono', ui-monospace, monospace";

// Defined at module scope (not inside the component) so the inputs are not
// remounted on every keystroke — that remount drops focus after one character.
const labelStyle: CSSProperties = {
  fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginBottom: 5,
};
const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 11px',
  background: 'var(--onyx-panel2)', borderRadius: 7, color: 'var(--onyx-text)',
  border: '1px solid var(--onyx-glass-edge)', outline: 'none', fontSize: 13, fontFamily: 'inherit',
};

function Field({ label, value, onChange, mono, full }: {
  label: string; value: string; onChange: (v: string) => void; mono?: boolean; full?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gridColumn: full ? '1 / -1' : undefined }}>
      <div style={labelStyle}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, fontFamily: mono ? MONO : 'inherit' }} />
    </div>
  );
}

// Chapter start-time input. Holds the raw text while editing and commits the
// parsed seconds on blur, so the H:MM:SS reformat doesn't fight the cursor.
function TimeInput({ value, onCommit }: { value: number; onCommit: (secs: number) => void }) {
  const [local, setLocal] = useState(fmtHMS(value));
  useEffect(() => setLocal(fmtHMS(value)), [value]);
  return (
    <input
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const s = parseHMS(local);
        const next = isNaN(s) ? value : s;
        onCommit(next);
        setLocal(fmtHMS(next));
      }}
      style={{ ...inputStyle, fontFamily: MONO, width: 90, flexShrink: 0, textAlign: 'right' }}
    />
  );
}

export interface MetadataEditorProps {
  item: LibraryItem;
  serverUrl: string;
  onClose: () => void;
  onComplete: (updated: LibraryItem) => void;
  onRefresh: () => void;
}

interface EditChapter { start: number; title: string; }

// ── Time helpers (H:MM:SS) ──────────────────────────────────────────────────────
function fmtHMS(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
function parseHMS(str: string): number {
  const parts = str.trim().split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// Parse "Series Name #Sequence" into parts (mirrors MatchModal).
function splitSeries(s: string): { name: string; sequence: string } {
  const hashIdx = s.lastIndexOf('#');
  if (hashIdx > 0) return { name: s.slice(0, hashIdx).trim(), sequence: s.slice(hashIdx + 1).trim() };
  return { name: s.trim(), sequence: '' };
}

// Build the "Series #seq" display string from an item's metadata.
function seriesDisplay(item: LibraryItem): string {
  const m = item.media.metadata as unknown as Record<string, unknown>;
  const series = m.series;
  if (Array.isArray(series) && series.length > 0) {
    const s = series[0] as { name?: string; sequence?: string };
    return s.sequence ? `${s.name ?? ''} #${s.sequence}` : (s.name ?? '');
  }
  return (m.seriesName as string) ?? '';
}

export default function MetadataEditor({ item, serverUrl, onClose, onComplete, onRefresh }: MetadataEditorProps) {
  const [tab, setTab] = useState<'details' | 'chapters'>('details');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Details form fields.
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [narrators, setNarrators] = useState('');
  const [series, setSeries] = useState('');
  const [publisher, setPublisher] = useState('');
  const [year, setYear] = useState('');
  const [genres, setGenres] = useState('');
  const [tags, setTags] = useState('');
  const [language, setLanguage] = useState('');
  const [isbn, setIsbn] = useState('');
  const [asin, setAsin] = useState('');
  const [description, setDescription] = useState('');
  const [explicit, setExplicit] = useState(false);

  // Chapters.
  const [chapters, setChapters] = useState<EditChapter[]>([]);
  const [duration, setDuration] = useState(0);

  // Seed from a fresh fetch so the form reflects current server state and the
  // (shelf-omitted) chapter data is present.
  useEffect(() => {
    let cancelled = false;
    fetchItem(serverUrl, item.id)
      .then(full => {
        if (cancelled) return;
        const m = full.media.metadata as unknown as Record<string, unknown>;
        setTitle((m.title as string) ?? '');
        setSubtitle((m.subtitle as string) ?? '');
        // The single-item fetch returns authors/narrators as object arrays with
        // authorName/narratorName often null. Read the arrays first, then the flat
        // name, then fall back to the (normalized) shelf prop — never seed with the
        // "Unknown Author" display sentinel.
        const authorArr = Array.isArray(m.authors) ? (m.authors as { name: string }[]).map(a => a.name).filter(Boolean) : [];
        let authorStr = authorArr.length ? authorArr.join(', ') : (typeof m.authorName === 'string' ? m.authorName : '');
        if (!authorStr) { const pa = bookAuthor(item); if (pa && pa !== 'Unknown Author') authorStr = pa; }
        setAuthors(authorStr);
        const narratorArr = Array.isArray(m.narrators) ? (m.narrators as string[]).filter(Boolean) : [];
        let narratorStr = narratorArr.length ? narratorArr.join(', ') : (typeof m.narratorName === 'string' ? m.narratorName : '');
        if (!narratorStr) narratorStr = bookNarrator(item);
        setNarrators(narratorStr);
        setSeries(seriesDisplay(full));
        setPublisher((m.publisher as string) ?? '');
        setYear((m.publishedYear as string) ?? '');
        setGenres(((m.genres as string[]) ?? []).join(', '));
        setTags((full.media.tags ?? []).join(', '));
        setLanguage((m.language as string) ?? '');
        setIsbn((m.isbn as string) ?? '');
        setAsin((m.asin as string) ?? '');
        setDescription((m.description as string) ?? '');
        setExplicit(!!m.explicit);
        setChapters((full.media.chapters ?? []).map(c => ({ start: c.start, title: c.title })));
        setDuration(full.media.duration ?? 0);
        setLoading(false);
      })
      .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [serverUrl, item.id]);

  // ── Save handlers ───────────────────────────────────────────────────────────

  async function saveDetails() {
    setSaving(true);
    setError(null);
    try {
      const metadata: Record<string, unknown> = {
        title: title.trim(),
        subtitle: subtitle.trim(),
        authors: authors.split(',').map(n => ({ name: n.trim() })).filter(o => o.name),
        narrators: narrators.split(',').map(n => n.trim()).filter(Boolean),
        publisher: publisher.trim(),
        publishedYear: year.trim(),
        genres: genres.split(',').map(g => g.trim()).filter(Boolean),
        language: language.trim(),
        isbn: isbn.trim(),
        asin: asin.trim(),
        description,
        explicit,
      };
      const ser = series.trim();
      metadata.series = ser ? [splitSeries(ser)] : [];
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      console.log('[Metadata] saving details for', item.id);
      await updateMedia(serverUrl, item.id, { metadata, tags: tagList });
      const updated = await fetchItem(serverUrl, item.id);
      onComplete(updated);
      onRefresh();
      onClose();
    } catch (e) {
      console.error('[Metadata] save details failed:', e);
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveChapterEdits() {
    setSaving(true);
    setError(null);
    try {
      // Drop empty-title rows, sort by start, and derive each end from the next
      // chapter's start (last chapter ends at the item duration).
      const sorted = chapters.filter(c => c.title.trim()).sort((a, b) => a.start - b.start);
      const payload = sorted.map((c, i) => ({
        start: c.start,
        end: i + 1 < sorted.length ? sorted[i + 1].start : duration,
        title: c.title.trim(),
      }));
      console.log('[Metadata] saving', payload.length, 'chapters for', item.id);
      await updateChapters(serverUrl, item.id, payload);
      const updated = await fetchItem(serverUrl, item.id);
      onComplete(updated);
      onRefresh();
      onClose();
    } catch (e) {
      console.error('[Metadata] save chapters failed:', e);
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

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
        {/* Header + tabs */}
        <div style={{ padding: '16px 22px 0', borderBottom: '1px solid var(--onyx-line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500 }}>Edit Metadata</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.media.metadata.title ?? item.id}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--onyx-text-mute)', fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['details', 'chapters'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: MONO, fontSize: 11, letterSpacing: '0.04em', textTransform: 'capitalize' as const,
                color: tab === t ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                borderBottom: `2px solid ${tab === t ? 'var(--onyx-accent)' : 'transparent'}`,
              }}>
                {t === 'chapters' ? `Chapters (${chapters.length})` : 'Details'}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>
          {loading && <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>Loading…</div>}

          {!loading && tab === 'details' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Title" value={title} onChange={setTitle} full />
              <Field label="Subtitle" value={subtitle} onChange={setSubtitle} full />
              <Field label="Authors (comma-separated)" value={authors} onChange={setAuthors} />
              <Field label="Narrators (comma-separated)" value={narrators} onChange={setNarrators} />
              <Field label="Series (Name #seq)" value={series} onChange={setSeries} />
              <Field label="Publisher" value={publisher} onChange={setPublisher} />
              <Field label="Published Year" value={year} onChange={setYear} />
              <Field label="Language" value={language} onChange={setLanguage} />
              <Field label="Genres (comma-separated)" value={genres} onChange={setGenres} full />
              <Field label="Tags (comma-separated)" value={tags} onChange={setTags} full />
              <Field label="ISBN" value={isbn} onChange={setIsbn} mono />
              <Field label="ASIN" value={asin} onChange={setAsin} mono />
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column' }}>
                <div style={labelStyle}>Description</div>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={5} style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
              <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--onyx-text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={explicit} onChange={e => setExplicit(e.target.checked)} />
                Explicit content
              </label>
            </div>
          )}

          {!loading && tab === 'chapters' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {chapters.length === 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--onyx-text-mute)', padding: '4px 0' }}>No chapters. Add one below.</div>
              )}
              {chapters.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', width: 24, textAlign: 'right' }}>{i + 1}</span>
                  <TimeInput
                    value={c.start}
                    onCommit={secs => setChapters(prev => prev.map((x, j) => j === i ? { ...x, start: secs } : x))}
                  />
                  <input
                    value={c.title}
                    onChange={e => setChapters(prev => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                    placeholder="Chapter title"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    onClick={() => setChapters(prev => prev.filter((_, j) => j !== i))}
                    title="Remove"
                    style={{ background: 'rgba(220,80,80,0.12)', border: '1px solid rgba(220,80,80,0.35)', color: '#e08a8a', borderRadius: 6, padding: '6px 9px', cursor: 'pointer', fontFamily: MONO, fontSize: 11, flexShrink: 0 }}
                  >✕</button>
                </div>
              ))}
              <button
                onClick={() => setChapters(prev => [...prev, { start: prev.length ? prev[prev.length - 1].start + 1 : 0, title: '' }])}
                style={{ alignSelf: 'flex-start', marginTop: 8, fontFamily: MONO, fontSize: 11, padding: '6px 12px', borderRadius: 6, background: 'var(--onyx-accent-dim)', border: '1px solid var(--onyx-accent-edge)', color: 'var(--onyx-accent)', cursor: 'pointer' }}
              >+ Add chapter</button>
              <div style={{ fontSize: 11, color: 'var(--onyx-text-mute)', marginTop: 8 }}>
                Times are H:MM:SS. Chapter ends are derived automatically from the next chapter's start.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 22px', borderTop: '1px solid var(--onyx-line)', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(8,8,11,0.6)', flexShrink: 0 }}>
          {error && <span style={{ fontFamily: MONO, fontSize: 10.5, color: '#e08a8a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{error}</span>}
          <span style={{ flex: error ? undefined : 1 }} />
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, background: 'transparent', border: '1px solid var(--onyx-glass-edge)', color: 'var(--onyx-text-dim)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button
            onClick={() => (tab === 'details' ? void saveDetails() : void saveChapterEdits())}
            disabled={saving || loading}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', cursor: saving || loading ? 'default' : 'pointer', background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', fontSize: 13, fontWeight: 600, opacity: saving || loading ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : tab === 'details' ? 'Save details' : 'Save chapters'}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
