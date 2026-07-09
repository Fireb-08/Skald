import { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import type { OnyxState } from '../../state/onyx';
import { bookTitle, bookAuthor } from '../../state/onyx';
import { updateCollection, removeBookFromCollection } from '../../api/abs';
import type { Collection } from '../../api/abs';
import Cover from '../Cover';
import { playBook } from '../../api/playbook';
import { log } from '../../lib/log';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO  = "'JetBrains Mono', ui-monospace, monospace";

export interface CollectionDetailProps {
  collection: Collection;
  serverUrl: string;
  st: OnyxState;
  onClose: () => void;
  onUpdated: (updated: Collection) => void;
}

export default function CollectionDetail({ collection, serverUrl, st, onClose, onUpdated }: CollectionDetailProps) {
  // Ordered list of book ids (the collection's book order).
  const [ids, setIds] = useState<string[]>(collection.books?.map(b => b.id) ?? []);
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description ?? '');
  const [editing, setEditing] = useState<'name' | 'description' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // Drag-to-reorder state (ref avoids re-renders mid-drag, which cause the
  // WebView "no-drop" cursor to flicker).
  const dragIndexRef = useRef<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Document-level dragover/​drop prevention keeps the move cursor across the
  // whole viewport for the lifetime of the modal.
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => {
      document.removeEventListener('dragover', prevent);
      document.removeEventListener('drop', prevent);
    };
  }, []);

  const resolve = (id: string) => st.library.find(b => b.id === id);

  async function saveField(field: 'name' | 'description', value: string) {
    setEditing(null);
    try {
      const updated = await updateCollection(serverUrl, collection.id, { [field]: value.trim() });
      onUpdated(updated);
    } catch (e) {
      log.error('library', 'collection save field failed', { field, err: String(e) });
    }
  }

  async function handleDrop(toIndex: number) {
    const fromIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragActive(false);
    setOverIndex(null);
    if (fromIndex === null || fromIndex === toIndex) return;
    const prev = ids;
    const reordered = ids.slice();
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setIds(reordered); // optimistic
    try {
      const updated = await updateCollection(serverUrl, collection.id, { books: reordered });
      setIds(updated.books?.map(b => b.id) ?? reordered);
      onUpdated(updated);
    } catch (e) {
      setIds(prev); // revert
      log.error('library', 'collection reorder failed', { err: String(e) });
    }
  }

  async function handleRemove(bookId: string) {
    setRemoving(bookId);
    try {
      const updated = await removeBookFromCollection(serverUrl, collection.id, bookId);
      setIds(updated.books?.map(b => b.id) ?? ids.filter(x => x !== bookId));
      onUpdated(updated);
    } catch (e) {
      log.error('library', 'collection remove book failed', { bookId, err: String(e) });
    } finally {
      setRemoving(null);
    }
  }

  async function handlePlayAll() {
    if (!ids.length) return;
    try { await playBook(st, ids[0]); st.setScreen('player'); onClose(); }
    catch (e) { log.error('playback', 'collection play all failed', { err: String(e) }); }
  }

  const editInput: React.CSSProperties = {
    width: '100%', background: 'transparent', border: 'none',
    borderBottom: '1px solid var(--onyx-accent-edge)', outline: 'none', padding: '2px 0',
    color: 'var(--onyx-text)', fontFamily: 'inherit',
  };

  const modal = (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      onDragOver={e => e.preventDefault()}
    >
      <div style={{ width: 'min(660px, 90vw)', maxHeight: '80vh', background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-line)', borderRadius: 14, boxShadow: '0 32px 80px rgba(0,0,0,0.75)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--onyx-line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editing === 'name' ? (
                <input autoFocus value={name} onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void saveField('name', name); if (e.key === 'Escape') setEditing(null); }}
                  onBlur={() => void saveField('name', name)}
                  style={{ ...editInput, fontFamily: SERIF, fontSize: 20, fontWeight: 500 }} />
              ) : (
                <div onClick={() => setEditing('name')} title="Click to rename"
                  style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500, cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name || '…'}
                </div>
              )}
              {editing === 'description' ? (
                <input autoFocus value={description} onChange={e => setDescription(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void saveField('description', description); if (e.key === 'Escape') setEditing(null); }}
                  onBlur={() => void saveField('description', description)}
                  placeholder="Add a description…"
                  style={{ ...editInput, marginTop: 6, fontSize: 12.5, fontStyle: 'italic', color: 'var(--onyx-text-dim)' }} />
              ) : (
                <div onClick={() => setEditing('description')} title="Click to edit description"
                  style={{ marginTop: 6, fontSize: 12.5, cursor: 'text', fontStyle: 'italic', color: description ? 'var(--onyx-text-dim)' : 'var(--onyx-text-mute)' }}>
                  {description || 'Add a description…'}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', background: 'transparent', border: '1px solid var(--onyx-glass-edge)', color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <button onClick={() => void handlePlayAll()} disabled={!ids.length}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 7, cursor: ids.length ? 'pointer' : 'default',
                background: ids.length ? 'var(--onyx-accent-dim)' : 'transparent', border: `1px solid ${ids.length ? 'var(--onyx-accent-edge)' : 'var(--onyx-line)'}`,
                color: ids.length ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              ▶ Play All
            </button>
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {ids.length} {ids.length === 1 ? 'book' : 'books'} · drag to reorder
            </div>
          </div>
        </div>

        {/* Item list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }} onDragOver={e => e.preventDefault()}>
          {ids.length === 0 && (
            <div style={{ padding: '32px 24px', fontFamily: SERIF, fontSize: 14, color: 'var(--onyx-text-mute)', fontStyle: 'italic', textAlign: 'center' }}>
              This collection is empty.
            </div>
          )}
          {ids.map((id, i) => {
            const book = resolve(id);
            const isOver = overIndex === i && dragActive && dragIndexRef.current !== i;
            const isDragging = dragActive && dragIndexRef.current === i;
            return (
              <div
                key={`${id}-${i}`}
                draggable
                onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; dragIndexRef.current = i; setDragActive(true); }}
                onDragOver={e => { e.stopPropagation(); e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overIndex !== i) setOverIndex(i); }}
                onDrop={e => { e.stopPropagation(); e.preventDefault(); void handleDrop(i); }}
                onDragEnd={() => { dragIndexRef.current = null; setDragActive(false); setOverIndex(null); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px',
                  borderTop: isOver ? '2px solid var(--onyx-accent)' : '2px solid transparent',
                  background: isDragging ? 'var(--onyx-accent-dim)' : i % 2 !== 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
                  opacity: isDragging ? 0.5 : 1, transition: 'background 0.1s',
                }}
              >
                <div style={{ flexShrink: 0, cursor: 'grab', color: 'var(--onyx-text-mute)', fontSize: 14, lineHeight: 1, userSelect: 'none' }} title="Drag to reorder">⠿</div>
                <div style={{ flexShrink: 0, width: 20, fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', textAlign: 'right' }}>{i + 1}</div>
                {book ? <Cover item={book} size={40} serverUrl={serverUrl} />
                      : <div style={{ width: 40, height: 40, borderRadius: 4, flexShrink: 0, background: 'var(--onyx-glass)', border: '1px dashed var(--onyx-glass-edge)' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: SERIF, fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {book ? bookTitle(book) : id}
                  </div>
                  {book && <div style={{ fontSize: 11.5, color: 'var(--onyx-text-dim)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bookAuthor(book)}</div>}
                </div>
                <button onClick={() => handleRemove(id)} disabled={removing === id} title="Remove from collection"
                  style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', background: 'transparent', border: '1px solid transparent', color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 13, lineHeight: 1 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#e8716a'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--onyx-text-mute)'; }}>
                  {removing === id ? '…' : '×'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
