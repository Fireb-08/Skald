import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import ReactDOM from 'react-dom';
import type { LibraryItem } from '../state/onyx';
import { getCollections, addBookToCollection, removeBookFromCollection, createCollection } from '../api/abs';
import type { Collection } from '../api/abs';
import Icon from './Icon';
import { useModalFocus } from '../hooks/useModalFocus';
import { errorMessage } from '../lib/presentError';
import { log } from '../lib/log';

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';

const footBtn: CSSProperties = {
  width: '100%', fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
  padding: '9px 14px', borderRadius: 8, cursor: 'pointer', lineHeight: 1, background: 'transparent',
};

export interface CollectionPickerProps {
  item: LibraryItem;
  serverUrl: string;
  onClose: () => void;
}

export default function CollectionPicker({ item, serverUrl, onClose }: CollectionPickerProps) {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  // Collection ids the book currently belongs to (drives the checkboxes).
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [newMode, setNewMode] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useModalFocus<HTMLDivElement>(onClose, !busyId && !creating);

  useEffect(() => {
    getCollections(serverUrl, item.libraryId)
      .then(cols => {
        setCollections(cols);
        setMembers(new Set(cols.filter(c => (c.books ?? []).some(b => b.id === item.id)).map(c => c.id)));
      })
      .catch(e => { log.warn('library', 'collection list failed', { err: String(e) }); setError(errorMessage(e, { operation: 'refresh' })); });
  }, [serverUrl, item.libraryId]);

  useEffect(() => {
    if (newMode) inputRef.current?.focus();
  }, [newMode]);

  // Toggle membership — add or remove the book; keep the modal open so several
  // collections can be set in one pass.
  async function toggle(col: Collection) {
    if (busyId || creating) return;
    setBusyId(col.id);
    setError('');
    const inCol = members.has(col.id);
    try {
      if (inCol) {
        await removeBookFromCollection(serverUrl, col.id, item.id);
        setMembers(prev => { const n = new Set(prev); n.delete(col.id); return n; });
      } else {
        await addBookToCollection(serverUrl, col.id, item.id);
        setMembers(prev => new Set(prev).add(col.id));
      }
    } catch (e) {
      log.warn('library', 'collection membership update failed', { collectionId: col.id, err: String(e) });
      setError(errorMessage(e, { operation: 'save' }));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createCollection(serverUrl, item.libraryId, name, item.id);
      onClose();
    } catch (e) {
      log.warn('library', 'collection create failed', { err: String(e) });
      setError(errorMessage(e, { operation: 'save' }));
      setCreating(false);
    }
  }

  function onNewKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleCreate();
    if (e.key === 'Escape') { setNewMode(false); setNewName(''); }
  }

  const modal = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        padding: 24,
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="collection-picker-title" style={{
        width: 360, maxHeight: '70vh',
        background: 'var(--onyx-panel)', border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 16,
        boxShadow: '0 40px 100px rgba(0,0,0,0.72), 0 0 0 1px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ flexShrink: 0, padding: '20px 20px 0 22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div id="collection-picker-title" style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.1 }}>Add to Collection</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', marginTop: 6 }}>Choose a collection for this book</div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, background: 'none', border: '1px solid transparent', color: 'var(--onyx-text-mute)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>✕</button>
        </div>
        <div style={{ flexShrink: 0, height: 1, background: 'var(--onyx-line)', margin: '14px 0 0' }} />

        {/* Collection list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {collections === null && !error && (
            <div style={{ padding: '16px 22px', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>Loading…</div>
          )}
          {error && (
            <div style={{ padding: '12px 22px', fontSize: 12, color: '#e8716a', fontFamily: MONO }}>{error}</div>
          )}
          {collections !== null && collections.length === 0 && (
            <div style={{ padding: '12px 22px', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>No collections yet — create one below.</div>
          )}
          {collections?.map(col => {
            const inCol = members.has(col.id);
            const rowBusy = busyId === col.id;
            return (
              <button
                key={col.id}
                disabled={busyId !== null || creating}
                onClick={() => toggle(col)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '10px 20px 10px 18px',
                  background: inCol ? 'var(--onyx-accent-dim)' : 'transparent',
                  border: 'none', borderLeft: `2px solid ${inCol ? 'var(--onyx-accent)' : 'transparent'}`,
                  color: inCol ? 'var(--onyx-accent)' : 'var(--onyx-text)',
                  fontSize: 13.5, textAlign: 'left', fontFamily: 'inherit',
                  cursor: (busyId !== null || creating) ? 'default' : 'pointer',
                  opacity: rowBusy ? 0.6 : 1, transition: 'background 0.1s, color 0.1s',
                }}
              >
                <Icon name="layers" size={15} color={inCol ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)'} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.name}</span>
                {/* Membership checkbox */}
                <span style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: inCol ? 'var(--onyx-accent)' : 'transparent',
                  border: `1px solid ${inCol ? 'var(--onyx-accent)' : 'var(--onyx-glass-edge)'}`,
                  color: 'var(--onyx-bg)',
                }}>
                  {inCol && <Icon name="check" size={12} />}
                </span>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: '12px 16px 16px', borderTop: '1px solid var(--onyx-line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {newMode ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                ref={inputRef}
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={onNewKeyDown}
                placeholder="Collection name…"
                disabled={creating}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--onyx-accent-edge)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--onyx-glass-edge)'; }}
                style={{ flex: 1, padding: '9px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 8, color: 'var(--onyx-text)', fontFamily: 'inherit', fontSize: 13, outline: 'none', transition: 'border-color 0.15s' }}
              />
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                style={{ ...footBtn, width: 'auto', whiteSpace: 'nowrap', border: '1px solid transparent', fontWeight: 600, background: newName.trim() && !creating ? 'var(--onyx-accent)' : 'var(--onyx-accent-dim)', color: newName.trim() && !creating ? 'var(--onyx-bg)' : 'var(--onyx-text-mute)', cursor: newName.trim() && !creating ? 'pointer' : 'default' }}
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setNewMode(true)}
              disabled={busyId !== null}
              style={{ ...footBtn, border: '1px dashed var(--onyx-accent-edge)', color: 'var(--onyx-accent)' }}
            >
              + New Collection
            </button>
          )}

          <button
            onClick={onClose}
            style={{ ...footBtn, border: '1px solid var(--onyx-glass-edge)', color: 'var(--onyx-text-dim)' }}
          >
            {members.size > 0 ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
