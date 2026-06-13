import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import ReactDOM from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { LibraryItem, OnyxState } from '../state/onyx';
import { bookAuthor } from '../state/onyx';
import { findCovers, setCoverUrl, uploadCover, removeCover, getCover, COVER_PROVIDERS } from '../api/abs';
import { bustCover } from '../lib/coverBust';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO  = "'JetBrains Mono', ui-monospace, monospace";

export interface CoverPickerProps {
  item: LibraryItem;
  st: OnyxState;
  onClose: () => void;
}

export default function CoverPicker({ item, st, onClose }: CoverPickerProps) {
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

  const label: CSSProperties = { fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginBottom: 5 };
  const input: CSSProperties = { padding: '7px 10px', background: 'var(--onyx-panel2)', borderRadius: 7, color: 'var(--onyx-text)', border: '1px solid var(--onyx-glass-edge)', outline: 'none', fontSize: 12.5, fontFamily: 'inherit' };

  const modal = (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div style={{ width: '100%', maxWidth: 720, maxHeight: '90vh', background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-line)', borderRadius: 14, boxShadow: '0 32px 80px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--onyx-line)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500 }}>Change Cover</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.title ?? item.id}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--onyx-text-mute)', fontSize: 18, padding: 4 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Current cover + actions */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ width: 96, height: 96, borderRadius: 6, background: 'var(--onyx-glass)', flexShrink: 0, overflow: 'hidden' }}>
              {previewSrc && <img src={convertFileSrc(previewSrc)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={label}>Current cover</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => void doUpload()} disabled={busy} style={{ ...input, cursor: 'pointer', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-accent)', background: 'var(--onyx-accent-dim)', border: '1px solid var(--onyx-accent-edge)' }}>Upload…</button>
                <button onClick={() => void doRemove()} disabled={busy} style={{ ...input, cursor: 'pointer', fontFamily: MONO, fontSize: 11, color: '#e08a8a', background: 'rgba(220,80,80,0.12)', border: '1px solid rgba(220,80,80,0.35)' }}>Remove</button>
              </div>
            </div>
          </div>

          {/* Search controls */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 120 }}>
              <div style={label}>Provider</div>
              <select value={provider} onChange={e => setProvider(e.target.value)} style={{ ...input, cursor: 'pointer' }}>
                {COVER_PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 140 }}>
              <div style={label}>Title</div>
              <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} style={input} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 120 }}>
              <div style={label}>Author</div>
              <input value={author} onChange={e => setAuthor(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} style={input} />
            </div>
            <button onClick={() => void doSearch()} disabled={searching || !title.trim()} style={{ padding: '8px 18px', borderRadius: 8, cursor: 'pointer', background: 'var(--onyx-accent)', border: 'none', color: 'var(--onyx-bg)', fontFamily: MONO, fontSize: 11, fontWeight: 600, opacity: searching || !title.trim() ? 0.6 : 1 }}>
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
