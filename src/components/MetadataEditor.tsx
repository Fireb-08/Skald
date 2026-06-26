import { useState, useEffect } from 'react';
import type { CSSProperties, FocusEvent } from 'react';
import ReactDOM from 'react-dom';
import type { LibraryItem } from '../state/onyx';
import { bookAuthor, bookNarrator } from '../state/onyx';
import { updateMedia, updateChapters, fetchItem, applyLocalMetadata, scanFolder, setLocalChapters } from '../api/abs';
import type { LocalMetadataFields } from '../api/abs';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO  = "'JetBrains Mono', ui-monospace, monospace";

// Defined at module scope (not inside the component) so the inputs are not
// remounted on every keystroke — that remount drops focus after one character.
const labelStyle: CSSProperties = {
  fontFamily: MONO, fontSize: 9, letterSpacing: '0.15em',
  textTransform: 'uppercase', color: 'var(--onyx-accent)', opacity: 0.72, marginBottom: 6,
};
const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  background: 'rgba(0,0,0,0.3)', borderRadius: 8, color: 'var(--onyx-text)',
  border: '1px solid var(--onyx-glass-edge)', outline: 'none', fontSize: 13, fontFamily: 'inherit',
  transition: 'border-color 0.15s, background 0.15s',
};
const sectionRule: CSSProperties = { gridColumn: '1 / -1', height: 1, background: 'var(--onyx-line)', margin: '3px 0' };

// Accent focus ring applied to text fields (the template's focused-input look).
// Theme-safe — uses the accent edge / glass edge vars.
const accentFocus = {
  onFocus: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = 'var(--onyx-accent-edge)';
    e.currentTarget.style.background = 'rgba(0,0,0,0.38)';
  },
  onBlur: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = 'var(--onyx-glass-edge)';
    e.currentTarget.style.background = 'rgba(0,0,0,0.3)';
  },
};

function Field({ label, value, onChange, mono, full }: {
  label: string; value: string; onChange: (v: string) => void; mono?: boolean; full?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gridColumn: full ? '1 / -1' : undefined }}>
      <div style={labelStyle}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} {...accentFocus} style={{ ...inputStyle, fontFamily: mono ? MONO : 'inherit' }} />
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
      onFocus={e => { e.currentTarget.style.borderColor = 'var(--onyx-accent-edge)'; e.currentTarget.style.background = 'rgba(0,0,0,0.35)'; }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.18)';
        e.currentTarget.style.background = 'rgba(0,0,0,0.25)';
        const s = parseHMS(local);
        const next = isNaN(s) ? value : s;
        onCommit(next);
        setLocal(fmtHMS(next));
      }}
      style={{
        width: 86, flexShrink: 0, fontFamily: MONO, fontSize: 12, color: 'var(--onyx-accent)', textAlign: 'center',
        background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.18)',
        borderRadius: 6, padding: '6px 8px', outline: 'none', transition: 'border-color 0.15s, background 0.15s',
      }}
    />
  );
}

export interface MetadataEditorProps {
  item: LibraryItem;
  serverUrl: string;
  onClose: () => void;
  onComplete: (updated: LibraryItem) => void;
  onRefresh: () => void;
  // Optional soft-notice channel (wired to the app toast) — used to report a
  // best-effort failure that didn't fail the save (e.g. local chapters saved to
  // the catalog but not embedded into the audio file).
  onNotice?: (message: string, type: 'info' | 'success') => void;
}

interface EditChapter { start: number; title: string; }

// Count a local item's audio files from its catalogued libraryFiles. Used to gate
// chapter write-back to single-file books — editing one global chapter list and
// writing it back across N files is ambiguous (the scanner derives multi-file
// chapters one-per-file), so multi-file local books keep chapters read-only.
function localAudioFileCount(item: LibraryItem): number {
  const files = (item as unknown as { libraryFiles?: Array<{ fileType?: string }> }).libraryFiles;
  return Array.isArray(files) ? files.filter(f => f.fileType === 'audio').length : 0;
}

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

export default function MetadataEditor({ item, serverUrl, onClose, onComplete, onRefresh, onNotice }: MetadataEditorProps) {
  // Local items are catalog-backed (no server). They seed from the item directly
  // and save via the catalog. Chapter write-back is supported for single-file
  // local books (catalog is authoritative; the file is updated best-effort via
  // tone). Multi-file local books keep chapters hidden — see localAudioFileCount.
  const isLocal = !!item.localPath;
  const isMultiFile = isLocal && localAudioFileCount(item) > 1;
  const tabs = isLocal
    ? (isMultiFile ? (['details'] as const) : (['details', 'chapters'] as const))
    : (['details', 'chapters'] as const);
  // Local single-file books offer an opt-out of embedding chapters into the file
  // (the catalog write always happens). Default on so edits are durable.
  const [writeToFile, setWriteToFile] = useState(true);
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
    // Local items: re-scan the book's files on open so the form reflects the
    // *actual* embedded tags, not just the (possibly stale) catalog snapshot.
    // File tags take precedence; the catalog fills anything the files lack —
    // folder-derived author/series, or fields set via an online Match that aren't
    // written back to the files. Chapters/duration come from the fresh read.
    if (isLocal) {
      let cancelled = false;
      (async () => {
        let fresh: Record<string, unknown> = {};
        let freshChapters: EditChapter[] | null = null;
        let freshDuration: number | null = null;
        try {
          const scanned = await scanFolder(item.localPath ?? '', item.libraryId);
          const f = scanned[0]?.item;
          if (f) {
            fresh = (f.media?.metadata ?? {}) as unknown as Record<string, unknown>;
            freshChapters = (f.media?.chapters ?? []).map(c => ({ start: c.start, title: c.title }));
            freshDuration = f.media?.duration ?? null;
          }
        } catch (e) {
          console.error('[edit] local file rescan failed, falling back to catalog:', e);
        }
        if (cancelled) return;
        const cat = item.media.metadata as unknown as Record<string, unknown>;
        // File value wins when present and non-empty; else the catalog value.
        const pick = (k: string): string => {
          const fv = fresh[k];
          if (typeof fv === 'string' && fv.trim()) return fv;
          const cv = cat[k];
          return typeof cv === 'string' ? cv : '';
        };
        setTitle(pick('title'));
        setSubtitle(pick('subtitle'));
        setAuthors(pick('authorName'));
        setNarrators(pick('narratorName'));
        const sName = pick('seriesName');
        const sSeq = pick('seriesSequence');
        setSeries(sName && sSeq ? `${sName} #${sSeq}` : sName);
        setPublisher(pick('publisher'));
        setYear(pick('publishedYear'));
        const fg = Array.isArray(fresh.genres) ? (fresh.genres as string[]) : [];
        const cg = Array.isArray(cat.genres) ? (cat.genres as string[]) : [];
        setGenres((fg.length ? fg : cg).join(', '));
        setTags((item.media.tags ?? []).join(', '));
        setLanguage(pick('language'));
        setIsbn(pick('isbn'));
        setAsin(pick('asin'));
        setDescription(pick('description'));
        setExplicit(!!cat.explicit);
        setChapters(freshChapters ?? (item.media.chapters ?? []).map(c => ({ start: c.start, title: c.title })));
        setDuration(freshDuration ?? item.media.duration ?? 0);
        setLoading(false);
      })();
      return () => { cancelled = true; };
    }
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
      // Local: write the catalog (source of truth) + re-file on identity change.
      if (isLocal) {
        const { name, sequence } = splitSeries(series.trim());
        const fields: LocalMetadataFields = {
          title: title.trim(),
          subtitle: subtitle.trim(),
          authorName: authors.split(',').map(s => s.trim()).filter(Boolean).join(', '),
          narratorName: narrators.split(',').map(s => s.trim()).filter(Boolean).join(', '),
          seriesName: name,
          seriesSequence: sequence,
          publisher: publisher.trim(),
          publishedYear: year.trim(),
          genres: genres.split(',').map(g => g.trim()).filter(Boolean),
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          language: language.trim(),
          isbn: isbn.trim(),
          asin: asin.trim(),
          description,
        };
        const updated = await applyLocalMetadata(item.libraryId, item.id, fields, null);
        onComplete(updated);
        onRefresh();
        onClose();
        return;
      }
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
      await updateMedia(serverUrl, item.id, { metadata, tags: tagList });
      const updated = await fetchItem(serverUrl, item.id);
      onComplete(updated);
      onRefresh();
      onClose();
    } catch (e) {
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
      // Local: write the catalog (source of truth) + optionally embed into the
      // file via tone. The returned item already carries the new chapters, so the
      // player/shelf update immediately; a soft fileWarning (file write skipped or
      // failed) is surfaced as a notice without failing the save.
      if (isLocal) {
        const { item: updated, fileWarning } = await setLocalChapters(item.id, payload, writeToFile);
        onComplete(updated);
        onRefresh();
        if (fileWarning) onNotice?.(fileWarning, 'info');
        onClose();
        return;
      }
      await updateChapters(serverUrl, item.id, payload);
      const updated = await fetchItem(serverUrl, item.id);
      onComplete(updated);
      onRefresh();
      onClose();
    } catch (e) {
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
        background: 'var(--onyx-panel)', border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 16,
        boxShadow: '0 40px 100px rgba(0,0,0,0.72), 0 0 0 1px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ flexShrink: 0, padding: '22px 22px 0 24px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.1 }}>Edit Metadata</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.media.metadata.title ?? item.id}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, background: 'none', border: '1px solid transparent', color: 'var(--onyx-text-mute)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>✕</button>
        </div>

        {/* Tabs (pills) */}
        <div style={{ flexShrink: 0, display: 'flex', gap: 5, padding: '16px 24px 0' }}>
          {tabs.map(t => {
            const active = tab === t;
            return (
              <button key={t} onClick={() => setTab(t)} style={{
                fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase' as const,
                padding: '4px 10px', borderRadius: 5, cursor: 'pointer', fontWeight: 500, lineHeight: 1.4,
                background: active ? 'var(--onyx-accent-dim)' : 'transparent',
                color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
                border: `1px solid ${active ? 'var(--onyx-accent-edge)' : 'transparent'}`,
              }}>
                {t === 'chapters' ? <>Chapters <span style={{ opacity: 0.55, fontSize: 8.5 }}>{chapters.length}</span></> : 'Details'}
              </button>
            );
          })}
        </div>
        <div style={{ flexShrink: 0, height: 1, background: 'var(--onyx-line)', margin: '14px 0 0' }} />

        {/* Body — chapters render full-bleed (own row padding), details stay padded */}
        <div style={{ flex: 1, overflowY: 'auto', padding: tab === 'chapters' ? 0 : '20px 24px 24px' }}>
          {loading && <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', padding: '20px 24px' }}>Loading…</div>}

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
              <div style={sectionRule} />
              <Field label="Genres (comma-separated)" value={genres} onChange={setGenres} full />
              <Field label="Tags (comma-separated)" value={tags} onChange={setTags} full />
              <div style={sectionRule} />
              <Field label="ISBN" value={isbn} onChange={setIsbn} mono />
              <Field label="ASIN" value={asin} onChange={setAsin} mono />
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column' }}>
                <div style={labelStyle}>Description</div>
                <textarea value={description} onChange={e => setDescription(e.target.value)} {...accentFocus} style={{ ...inputStyle, resize: 'none', height: 110, lineHeight: 1.6, fontSize: 12.5 }} />
              </div>
              <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--onyx-text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={explicit} onChange={e => setExplicit(e.target.checked)} />
                Explicit content
              </label>
            </div>
          )}

          {!loading && tab === 'chapters' && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {chapters.length === 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--onyx-text-mute)', padding: '16px 24px' }}>No chapters. Add one below.</div>
              )}
              {chapters.map((c, i) => (
                <div
                  key={i}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 24px 7px 20px', borderBottom: i < chapters.length - 1 ? '1px solid var(--onyx-line)' : 'none', transition: 'background 0.1s' }}
                >
                  <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', minWidth: 22, textAlign: 'right', flexShrink: 0, letterSpacing: '0.02em' }}>{i + 1}</span>
                  <TimeInput
                    value={c.start}
                    onCommit={secs => setChapters(prev => prev.map((x, j) => j === i ? { ...x, start: secs } : x))}
                  />
                  <input
                    value={c.title}
                    onChange={e => setChapters(prev => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                    placeholder="Chapter title"
                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--onyx-accent-edge)'; e.currentTarget.style.background = 'rgba(0,0,0,0.32)'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'var(--onyx-glass-edge)'; e.currentTarget.style.background = 'rgba(0,0,0,0.22)'; }}
                    style={{ flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.22)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, padding: '6px 10px', color: 'var(--onyx-text)', fontFamily: 'inherit', fontSize: 12.5, outline: 'none', transition: 'border-color 0.15s, background 0.15s' }}
                  />
                  <button
                    onClick={() => setChapters(prev => prev.filter((_, j) => j !== i))}
                    title="Remove"
                    onMouseEnter={e => { e.currentTarget.style.color = '#e8716a'; e.currentTarget.style.background = 'rgba(220,80,80,0.12)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--onyx-text-mute)'; e.currentTarget.style.background = 'none'; }}
                    style={{ width: 26, height: 26, borderRadius: 6, background: 'none', border: 'none', color: 'var(--onyx-text-mute)', opacity: 0.6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, lineHeight: 1, transition: 'color 0.15s, background 0.15s' }}
                  >✕</button>
                </div>
              ))}
              {/* Add + hint — padded so it doesn't sit flush against the full-bleed rows */}
              <div style={{ padding: '14px 24px 6px' }}>
                <button
                  onClick={() => setChapters(prev => [...prev, { start: prev.length ? prev[prev.length - 1].start + 1 : 0, title: '' }])}
                  style={{ fontFamily: MONO, fontSize: 11, padding: '6px 12px', borderRadius: 6, background: 'var(--onyx-accent-dim)', border: '1px solid var(--onyx-accent-edge)', color: 'var(--onyx-accent)', cursor: 'pointer' }}
                >+ Add chapter</button>
                <div style={{ fontSize: 11, color: 'var(--onyx-text-mute)', marginTop: 10, lineHeight: 1.5 }}>
                  Times are H:MM:SS. Chapter ends are derived automatically from the next chapter's start.
                </div>
                {/* Local single-file books: chapters always save to the library;
                    this also embeds them into the audio file so they survive a
                    re-scan. Best-effort — a locked file leaves the library edit. */}
                {isLocal && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--onyx-text-dim)', cursor: 'pointer', marginTop: 12 }}>
                    <input type="checkbox" checked={writeToFile} onChange={e => setWriteToFile(e.target.checked)} />
                    Write chapters into the audio file
                  </label>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '13px 24px', borderTop: '1px solid var(--onyx-line)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 9, flexShrink: 0 }}>
          {error && <span style={{ fontFamily: MONO, fontSize: 10.5, color: '#e08a8a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{error}</span>}
          <button onClick={onClose} style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase' as const, fontWeight: 500, padding: '8px 16px', borderRadius: 7, cursor: 'pointer', lineHeight: 1, background: 'transparent', border: '1px solid var(--onyx-glass-edge)', color: 'var(--onyx-text-dim)' }}>Cancel</button>
          <button
            onClick={() => (tab === 'details' ? void saveDetails() : void saveChapterEdits())}
            disabled={saving || loading}
            style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase' as const, fontWeight: 600, padding: '8px 16px', borderRadius: 7, cursor: saving || loading ? 'default' : 'pointer', lineHeight: 1, border: '1px solid transparent', background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', opacity: saving || loading ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : tab === 'details' ? 'Save details' : 'Save chapters'}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
