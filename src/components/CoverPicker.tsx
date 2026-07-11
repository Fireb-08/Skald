import { useState, useEffect } from 'react';
import type { CSSProperties, FocusEvent } from 'react';
import ReactDOM from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { LibraryItem, OnyxState } from '../state/onyx';
import { bookAuthor } from '../state/onyx';
import { findCovers, setCoverUrl, uploadCover, removeCover, getCover, COVER_PROVIDERS } from '../api/abs';
import { bustCover } from '../lib/coverBust';
import { useModalFocus } from '../hooks/useModalFocus';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO  = "'JetBrains Mono', ui-monospace, monospace";

// Accent focus ring for text fields / selects (theme-safe).
const accentFocus = {
  onFocus: (e: FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = 'var(--onyx-accent-edge)';
    e.currentTarget.style.background = 'rgba(0,0,0,0.38)';
  },
  onBlur: (e: FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = 'var(--onyx-glass-edge)';
    e.currentTarget.style.background = 'rgba(0,0,0,0.3)';
  },
};

export interface CoverPickerProps {
  item: LibraryItem;
  st: OnyxState;
  onClose: () => void;
}

export default function CoverPicker({ item, st, onClose }: CoverPickerProps) {
  const dialogRef = useModalFocus<HTMLDivElement>(onClose);
  const meta = item.media.metadata;
  const [provider, setProvider] = useState<string>(COVER_PROVIDERS[0]);
  const [title, setTitle] = useState(meta.title ?? '');
  const [author, setAuthor] = useState(bookAuthor(item) === 'Unknown Author' ? '' : bookAuthor(item));
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Local token to force the current-cover preview to reload after a change.
  const [previewBust, setPreviewBust] = useState(0);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  // Load (and reload) the current cover preview.
  useEffect(() => {
    let cancelled = false;
    getCover(st.serverUrl, item.id, 400, previewBust)
      .then(path => { if (!cancelled) setPreviewSrc(path); })
      .catch(() => { if (!cancelled) setPreviewSrc(null); });
    return () => { cancelled = true; };
  }, [st.serverUrl, item.id, previewBust]);

  async function doSearch() {
    setSearching(true);
    try {
      const urls = await findCovers(st.serverUrl, title.trim(), author.trim(), provider);
      setResults(urls);
    } catch (e) {
      st.setToast({ message: `Cover search failed: ${e}`, type: 'error' });
    } finally {
      setSearching(false);
    }
  }

  // After any change: bust the shelf caches, refresh the preview, refresh library.
  function afterChange(msg: string) {
    bustCover(item.id);
    setPreviewBust(b => b + 1);
    st.refreshLibrary().catch(() => {});
    st.setToast({ message: msg, type: 'success' });
  }

  async function pick(url: string) {
    setBusy(true);
    try {
      await setCoverUrl(st.serverUrl, item.id, url);
      afterChange('Cover updated.');
    } catch (e) {
      st.setToast({ message: `Failed to set cover: ${e}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function doUpload() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    });
    if (!selected || typeof selected !== 'string') return;
    setBusy(true);
    try {
      await uploadCover(st.serverUrl, item.id, selected);
      afterChange('Cover uploaded.');
    } catch (e) {
      st.setToast({ message: `Upload failed: ${e}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function doRemove() {
    setBusy(true);
    try {
      await removeCover(st.serverUrl, item.id);
      afterChange('Cover removed.');
    } catch (e) {
      st.setToast({ message: `Failed to remove: ${e}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const label: CSSProperties = { fontFamily: MONO, fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--onyx-accent)', opacity: 0.72, marginBottom: 6 };
  const input: CSSProperties = { padding: '9px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: 8, color: 'var(--onyx-text)', border: '1px solid var(--onyx-glass-edge)', outline: 'none', fontSize: 12.5, fontFamily: 'inherit', transition: 'border-color 0.15s, background 0.15s' };
  const btnMono: CSSProperties = { fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500, padding: '8px 14px', borderRadius: 7, cursor: 'pointer', lineHeight: 1 };

  const modal = (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cover-picker-title" style={{
        width: '100%', maxWidth: 720, maxHeight: '90vh',
        background: 'var(--onyx-panel)', border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 16,
        boxShadow: '0 40px 100px rgba(0,0,0,0.72), 0 0 0 1px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ flexShrink: 0, padding: '22px 22px 0 24px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div id="cover-picker-title" style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.1 }}>Change Cover</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.title ?? item.id}</div>
          </div>
          <button onClick={onClose} aria-label="Close cover picker" style={{ width: 28, height: 28, borderRadius: 7, background: 'none', border: '1px solid transparent', color: 'var(--onyx-text-mute)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>✕</button>
        </div>
        <div style={{ flexShrink: 0, height: 1, background: 'var(--onyx-line)', margin: '14px 0 0' }} />

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Current cover + actions */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ width: 96, height: 96, borderRadius: 6, background: 'var(--onyx-glass)', flexShrink: 0, overflow: 'hidden' }}>
              {previewSrc && <img src={convertFileSrc(previewSrc)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={label}>Current cover</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => void doUpload()} disabled={busy} style={{ ...btnMono, color: 'var(--onyx-accent)', background: 'var(--onyx-accent-dim)', border: '1px solid var(--onyx-accent-edge)' }}>Upload…</button>
                <button onClick={() => void doRemove()} disabled={busy} style={{ ...btnMono, color: '#e08a8a', background: 'rgba(220,80,80,0.12)', border: '1px solid rgba(220,80,80,0.35)' }}>Remove</button>
              </div>
            </div>
          </div>

          {/* Search controls */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 120 }}>
              <div style={label}>Provider</div>
              <select value={provider} onChange={e => setProvider(e.target.value)} {...accentFocus} style={{ ...input, cursor: 'pointer' }}>
                {COVER_PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 140 }}>
              <div style={label}>Title</div>
              <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} {...accentFocus} style={input} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 120 }}>
              <div style={label}>Author</div>
              <input value={author} onChange={e => setAuthor(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} {...accentFocus} style={input} />
            </div>
            <button onClick={() => void doSearch()} disabled={searching || !title.trim()} style={{ ...btnMono, padding: '8px 16px', background: 'var(--onyx-accent)', border: '1px solid transparent', color: 'var(--onyx-bg)', fontWeight: 600, opacity: searching || !title.trim() ? 0.6 : 1 }}>
              {searching ? 'Searching…' : 'Find covers'}
            </button>
          </div>

          {/* Results grid */}
          {results.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10 }}>
              {results.map((url, i) => (
                <button key={i} onClick={() => void pick(url)} disabled={busy} title="Use this cover" style={{ padding: 0, border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, overflow: 'hidden', cursor: busy ? 'default' : 'pointer', background: 'var(--onyx-glass)', aspectRatio: '1 / 1' }}>
                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}
          {!searching && results.length === 0 && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', padding: '8px 0' }}>
              Search a provider for cover art, or upload your own image.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
