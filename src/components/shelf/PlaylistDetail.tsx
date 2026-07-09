import { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import type { OnyxState } from '../../state/onyx';
import { bookTitle, bookAuthor } from '../../state/onyx';
import { getPlaylist, updatePlaylist, batchRemoveFromPlaylist } from '../../api/abs';
import type { Playlist, PlaylistItem, PlaylistItemInput } from '../../api/abs';
import Cover from '../Cover';
import { playBook } from '../../api/playbook';
import { log } from '../../lib/log';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO  = "'JetBrains Mono', ui-monospace, monospace";

export interface PlaylistDetailProps {
  playlistId: string;
  serverUrl: string;
  st: OnyxState;
  onClose: () => void;
  onDeleted: () => void;
  onUpdated: (updated: Playlist) => void;
}

function toInputs(items: PlaylistItem[]): PlaylistItemInput[] {
  return items.map(i => ({
    libraryItemId: i.libraryItemId,
    ...(i.episodeId ? { episodeId: i.episodeId } : {}),
  }));
}

export default function PlaylistDetail({
  playlistId, serverUrl, st, onClose, onDeleted, onUpdated,
}: PlaylistDetailProps) {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Inline editing
  const [editingField, setEditingField] = useState<'name' | 'description' | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [pendingDescription, setPendingDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const canceledRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const descInputRef = useRef<HTMLInputElement>(null);

  // Item operations
  const [removing, setRemoving] = useState<string | null>(null);

  // Drag-to-reorder — dragIndexRef avoids re-renders during drag (which cause
  // brief gaps in dragover coverage and produce the stop-sign cursor in WebView).
  // dragActive + overIndex are the only state, kept minimal to limit re-renders.
  const dragIndexRef = useRef<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Document-level dragover prevention: guarantees the move cursor across the
  // entire viewport for the lifetime of the modal, regardless of which element
  // the pointer is over at any given moment during a drag.
  useEffect(() => {
    const prevent = (e: DragEvent) => { e.preventDefault(); };
    const onDocDrop = (e: DragEvent) => { e.preventDefault(); };
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', onDocDrop);
    return () => {
      document.removeEventListener('dragover', prevent);
      document.removeEventListener('drop', onDocDrop);
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    getPlaylist(serverUrl, playlistId)
      .then(p => { setPlaylist(p); setItems(p.items); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [serverUrl, playlistId]);

  useEffect(() => {
    if (editingField === 'name') nameInputRef.current?.focus();
    if (editingField === 'description') descInputRef.current?.focus();
  }, [editingField]);

  // ── Resolve a PlaylistItem to a LibraryItem for display ────────────────────
  const resolveItem = (pi: PlaylistItem) =>
    st.library.find(b => b.id === pi.libraryItemId);

  // ── Inline name/description save ─────────────────────────────────────────
  async function saveName() {
    if (!playlist || !pendingName.trim() || saving) return;
    setSaving(true);
    try {
      const updated = await updatePlaylist(serverUrl, playlist.id, pendingName.trim());
      setPlaylist(prev => prev ? { ...prev, name: updated.name } : prev);
      onUpdated(updated);
      setEditingField(null);
    } catch (e) {
      log.error('library', 'playlist rename failed', { playlistId: playlist.id, err: String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function saveDescription() {
    if (!playlist || saving) return;
    setSaving(true);
    try {
      const updated = await updatePlaylist(serverUrl, playlist.id, undefined, pendingDescription.trim() || undefined);
      setPlaylist(prev => prev ? { ...prev, description: updated.description } : prev);
      onUpdated(updated);
      setEditingField(null);
    } catch (e) {
      log.error('library', 'playlist description save failed', { playlistId: playlist.id, err: String(e) });
    } finally {
      setSaving(false);
    }
  }

  function onNameKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { void saveName(); }
    if (e.key === 'Escape') {
      canceledRef.current = true;
      setEditingField(null);
    }
  }

  function onDescKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { void saveDescription(); }
    if (e.key === 'Escape') {
      canceledRef.current = true;
      setEditingField(null);
    }
  }

  function onNameBlur() {
    if (canceledRef.current) { canceledRef.current = false; return; }
    void saveName();
  }

  function onDescBlur() {
    if (canceledRef.current) { canceledRef.current = false; return; }
    void saveDescription();
  }

  // ── Remove item ───────────────────────────────────────────────────────────
  function handleRemove(libraryItemId: string) {
    if (!playlist) return;

    if (items.length === 1) {
      // Last item — removing it will auto-delete the playlist on the server.
      const title = resolveItem(items[0]);
      const bookName = title ? bookTitle(title) : libraryItemId;
      st.setConfirmDialog({
        title: 'Remove last item?',
        message: `Removing "${bookName}" will delete the playlist "${playlist.name}" — ABS automatically removes empty playlists.`,
        confirmLabel: 'Remove & Delete',
        onConfirm: async () => {
          try {
            await batchRemoveFromPlaylist(serverUrl, playlist.id, [{ libraryItemId }]);
          } catch {
            // ABS may 404 because the playlist was auto-deleted — expected.
          }
          onDeleted();
          onClose();
        },
      });
      return;
    }

    setRemoving(libraryItemId);
    batchRemoveFromPlaylist(serverUrl, playlist.id, [{ libraryItemId }])
      .then(updated => { setItems(updated.items); })
      .catch(e => log.error('library', 'playlist remove item failed', { libraryItemId, err: String(e) }))
      .finally(() => setRemoving(null));
  }

  // ── Drag-to-reorder ───────────────────────────────────────────────────────
  async function handleDrop(toIndex: number) {
    const fromIndex = dragIndexRef.current;
    if (fromIndex === null || fromIndex === toIndex || !playlist) return;
    const prevItems = items;
    const reordered = items.slice();
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    dragIndexRef.current = null;
    setDragActive(false);
    setOverIndex(null);
    setItems(reordered); // optimistic
    try {
      const updated = await updatePlaylist(serverUrl, playlist.id, undefined, undefined, toInputs(reordered));
      setItems(updated.items);
      onUpdated(updated);
      log.info('library', 'playlist reorder saved', { playlistId: playlist.id, from: fromIndex, to: toIndex });
    } catch (e) {
      setItems(prevItems); // revert on server error
      log.error('library', 'playlist reorder failed', { playlistId: playlist.id, err: String(e) });
    }
  }

  // ── Play All ──────────────────────────────────────────────────────────────
  async function handlePlayAll() {
    if (!items.length || !playlist) return;
    const firstId = items[0].libraryItemId;
    try {
      await playBook(st, firstId);
      st.setScreen('player');
      onClose();
    } catch (e) {
      log.error('playback', 'playlist play all failed', { err: String(e) });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  const modal = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      onDragOver={e => e.preventDefault()}
    >
      <div style={{
        width: 'min(660px, 90vw)',
        background: 'var(--onyx-panel2)',
        border: '1px solid var(--onyx-line)',
        borderRadius: 14,
        boxShadow: '0 32px 80px rgba(0,0,0,0.75)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '80vh',
        overflow: 'hidden',
      }}>

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--onyx-line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Editable name */}
              {editingField === 'name' ? (
                <input
                  ref={nameInputRef}
                  value={pendingName}
                  onChange={e => setPendingName(e.target.value)}
                  onKeyDown={onNameKeyDown}
                  onBlur={onNameBlur}
                  disabled={saving}
                  style={{
                    width: '100%', background: 'transparent',
                    border: 'none', borderBottom: '1px solid var(--onyx-accent-edge)',
                    outline: 'none', padding: '2px 0',
                    fontFamily: SERIF, fontSize: 20, fontWeight: 500, color: 'var(--onyx-text)',
                  }}
                />
              ) : (
                <div
                  onClick={() => { setPendingName(playlist?.name ?? ''); setEditingField('name'); }}
                  title="Click to rename"
                  style={{
                    fontFamily: SERIF, fontSize: 20, fontWeight: 500, color: 'var(--onyx-text)',
                    cursor: 'text', borderBottom: '1px solid transparent',
                    transition: 'border-color 0.15s',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {playlist?.name ?? '…'}
                </div>
              )}

              {/* Editable description */}
              {editingField === 'description' ? (
                <input
                  ref={descInputRef}
                  value={pendingDescription}
                  onChange={e => setPendingDescription(e.target.value)}
                  onKeyDown={onDescKeyDown}
                  onBlur={onDescBlur}
                  disabled={saving}
                  placeholder="Add a description…"
                  style={{
                    width: '100%', background: 'transparent',
                    border: 'none', borderBottom: '1px solid var(--onyx-accent-edge)',
                    outline: 'none', padding: '2px 0', marginTop: 6,
                    fontFamily: 'inherit', fontSize: 12.5, color: 'var(--onyx-text-dim)',
                    fontStyle: 'italic',
                  }}
                />
              ) : (
                <div
                  onClick={() => { setPendingDescription(playlist?.description ?? ''); setEditingField('description'); }}
                  title="Click to edit description"
                  style={{
                    marginTop: 6, fontSize: 12.5, cursor: 'text',
                    color: playlist?.description ? 'var(--onyx-text-dim)' : 'var(--onyx-text-mute)',
                    fontStyle: 'italic',
                  }}
                >
                  {playlist?.description ?? 'Add a description…'}
                </div>
              )}
            </div>

            {/* Close */}
            <button
              onClick={onClose}
              style={{
                flexShrink: 0, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--onyx-glass-edge)',
                color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 14, lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          {/* Toolbar row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <button
              onClick={() => { void handlePlayAll(); }}
              disabled={!items.length}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 7, cursor: items.length ? 'pointer' : 'default',
                background: items.length ? 'var(--onyx-accent-dim)' : 'transparent',
                border: `1px solid ${items.length ? 'var(--onyx-accent-edge)' : 'var(--onyx-line)'}`,
                color: items.length ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
                fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
              }}
            >
              ▶ Play All
            </button>
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </div>
          </div>
        </div>

        {/* ── Item list ─────────────────────────────────────────────────── */}
        <div
          style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}
          onDragOver={e => e.preventDefault()}
        >
          {loading && (
            <div style={{ padding: '24px 24px', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>
              Loading…
            </div>
          )}
          {error && (
            <div style={{ padding: '12px 24px', fontSize: 12, color: '#e8716a' }}>{error}</div>
          )}
          {!loading && !error && items.length === 0 && (
            <div style={{ padding: '32px 24px', fontFamily: SERIF, fontSize: 14, color: 'var(--onyx-text-mute)', fontStyle: 'italic', textAlign: 'center' }}>
              This playlist is empty.
            </div>
          )}
          {items.map((pi, i) => {
            const book = resolveItem(pi);
            const isOver = overIndex === i && dragActive && dragIndexRef.current !== i;
            const isDragging = dragActive && dragIndexRef.current === i;
            return (
              <div
                key={`${pi.libraryItemId}-${i}`}
                draggable
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'move';
                  dragIndexRef.current = i;
                  setDragActive(true);
                }}
                onDragOver={e => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (overIndex !== i) setOverIndex(i);
                }}
                onDrop={e => {
                  e.stopPropagation();
                  e.preventDefault();
                  void handleDrop(i);
                }}
                onDragEnd={() => {
                  dragIndexRef.current = null;
                  setDragActive(false);
                  setOverIndex(null);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 20px',
                  borderTop: isOver ? '2px solid var(--onyx-accent)' : '2px solid transparent',
                  background: isDragging
                    ? 'var(--onyx-accent-dim)'
                    : i % 2 !== 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
                  opacity: isDragging ? 0.5 : 1,
                  cursor: 'default',
                  transition: 'background 0.1s',
                }}
              >
                {/* Drag handle */}
                <div
                  style={{
                    flexShrink: 0, cursor: 'grab', color: 'var(--onyx-text-mute)',
                    fontSize: 14, lineHeight: 1, userSelect: 'none', paddingRight: 2,
                  }}
                  title="Drag to reorder"
                >
                  ⠿
                </div>

                {/* Position number */}
                <div style={{ flexShrink: 0, width: 20, fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', textAlign: 'right' }}>
                  {i + 1}
                </div>

                {/* Cover */}
                {book ? (
                  <Cover item={book} size={40} serverUrl={serverUrl} />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 4, flexShrink: 0, background: 'var(--onyx-glass)', border: '1px dashed var(--onyx-glass-edge)' }} />
                )}

                {/* Title + author */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: SERIF, fontSize: 13.5, fontWeight: 500, color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {book ? bookTitle(book) : pi.libraryItemId}
                  </div>
                  {book && (
                    <div style={{ fontSize: 11.5, color: 'var(--onyx-text-dim)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {bookAuthor(book)}
                    </div>
                  )}
                </div>

                {/* Remove button */}
                <button
                  onClick={() => handleRemove(pi.libraryItemId)}
                  disabled={removing === pi.libraryItemId}
                  title="Remove from playlist"
                  style={{
                    flexShrink: 0, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                    background: 'transparent', border: '1px solid transparent',
                    color: removing === pi.libraryItemId ? 'var(--onyx-text-mute)' : 'var(--onyx-text-mute)',
                    fontFamily: MONO, fontSize: 13, lineHeight: 1,
                    transition: 'color 0.1s, border-color 0.1s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.color = '#e8716a';
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(232,113,106,0.3)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--onyx-text-mute)';
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
                  }}
                >
                  {removing === pi.libraryItemId ? '…' : '×'}
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
