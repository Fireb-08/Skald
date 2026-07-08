import { useState, useEffect } from 'react';
import type { OnyxState, LibraryItem } from '../../../state/onyx';
import { bookTitle, bookAuthor } from '../../../state/onyx';
import { groupMatchesFilter } from '../../../lib/shelfFilters';
import { getPlaylists, createPlaylist } from '../../../api/abs';
import type { Playlist } from '../../../api/abs';
import BrowseView from '../BrowseView';
import BrowseList from '../BrowseList';
import BrowseTile from '../BrowseTile';
import Cover from '../../Cover';
import PlaylistDetail from '../PlaylistDetail';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface PlaylistsViewProps {
  st: OnyxState;
  inline?: boolean;
}

export default function PlaylistsView({ st, inline = false }: PlaylistsViewProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [detailPlaylistId, setDetailPlaylistId] = useState<string | null>(null);

  // Active library id, not the first shelf item's — an empty ABS library still
  // has server-side playlists and must allow creating one. ABS-only feature, so
  // local libraries resolve to ''. (See CollectionsView for the same pattern.)
  const libraryId = st.activeLibrary?.source === 'local'
    ? ''
    : (st.activeLibrary?.id ?? st.library[0]?.libraryId ?? '');

  useEffect(() => {
    if (!libraryId || !st.serverUrl) { setLoading(false); return; }
    setLoading(true);
    getPlaylists(st.serverUrl, libraryId)
      .then(result => { setPlaylists(result); setLoading(false); })
      .catch(() => setLoading(false));
  }, [st.serverUrl, libraryId]);

  const booksFor = (p: Playlist): LibraryItem[] =>
    p.items
      .map(pi => st.library.find(b => b.id === pi.libraryItemId))
      .filter((b): b is LibraryItem => Boolean(b));

  let filtered = playlists.slice();

  if (st.search) {
    const q = st.search.toLowerCase();
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q) ||
      p.items.some(pi => {
        const b = st.library.find(x => x.id === pi.libraryItemId);
        return b && (bookTitle(b).toLowerCase().includes(q) || bookAuthor(b).toLowerCase().includes(q));
      }),
    );
  }

  if (st.filter !== 'all') {
    filtered = filtered.filter(p => groupMatchesFilter(booksFor(p), st.filter, st.mediaProgress));
  }

  const openPlaylist = (p: Playlist) => {
    const bookIds = p.items.map(pi => pi.libraryItemId);
    st.setContextFilter({
      kind: 'playlist',
      value: p.name,
      playlistId: p.id,
      bookIds,
    });
    st.setShelfTab('library');
    st.setScreen('library');
  };

  const handleCreate = async () => {
    if (!newName.trim() || !libraryId || !st.serverUrl) return;
    setCreating(true);
    try {
      const playlist = await createPlaylist(st.serverUrl, libraryId, newName.trim());
      setPlaylists(prev => [playlist, ...prev]);
      setNewName('');
      setCreateOpen(false);
    } catch (e) {
      console.error('[PlaylistsView] create failed:', e);
    } finally {
      setCreating(false);
    }
  };

  const subtitle = loading
    ? 'Loading…'
    : `${filtered.length} ${filtered.length === 1 ? 'playlist' : 'playlists'}`;

  return (
    <>
      <BrowseView st={st} title="Playlists" subtitle={subtitle} showModeToggle inline={inline}>

        {/* Create playlist bar */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: createOpen ? 10 : 20 }}>
          <button
            onClick={() => setCreateOpen(o => !o)}
            style={{
              padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
              background: createOpen ? 'transparent' : 'var(--onyx-accent-dim)',
              border: `1px solid ${createOpen ? 'var(--onyx-line)' : 'var(--onyx-accent-edge)'}`,
              color: createOpen ? 'var(--onyx-text-mute)' : 'var(--onyx-accent)',
              fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
            }}
          >
            {createOpen ? 'Cancel' : '+ New Playlist'}
          </button>
        </div>

        {createOpen && (
          <div style={{
            marginBottom: 22, padding: '14px 18px', borderRadius: 12,
            background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { void handleCreate(); }
                if (e.key === 'Escape') { setCreateOpen(false); setNewName(''); }
              }}
              placeholder="Playlist name…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontFamily: SERIF, fontSize: 16, color: 'var(--onyx-text)',
              }}
            />
            <button
              onClick={() => { void handleCreate(); }}
              disabled={!newName.trim() || creating}
              style={{
                padding: '6px 14px', borderRadius: 7, cursor: newName.trim() ? 'pointer' : 'default',
                background: newName.trim() ? 'var(--onyx-accent-dim)' : 'transparent',
                border: `1px solid ${newName.trim() ? 'var(--onyx-accent-edge)' : 'var(--onyx-line)'}`,
                color: newName.trim() ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
                fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
              }}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em' }}>
            Loading playlists…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: SERIF, fontSize: 15, color: 'var(--onyx-text-mute)', fontStyle: 'italic' }}>
            {playlists.length === 0
              ? 'No playlists yet — click "+ New Playlist" to create one.'
              : 'No playlists match the current filter.'}
          </div>
        ) : st.libraryView === 'grid' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}>
            {filtered.map(p => {
              const books = booksFor(p);
              return (
                <BrowseTile
                  key={p.id}
                  mode={st.browseTileStyle}
                  tag="Playlist"
                  title={p.name}
                  subtitle={p.description || undefined}
                  stat={`${p.items.length} TITLE${p.items.length === 1 ? '' : 'S'}`}
                  books={books}
                  serverUrl={st.serverUrl}
                  onClick={() => openPlaylist(p)}
                  emptyLabel="Empty playlist"
                  corner={
                    // div (not button) + stopPropagation — valid inside BrowseTile's button.
                    <div
                      onClick={e => { e.stopPropagation(); setDetailPlaylistId(p.id); }}
                      title="Manage playlist"
                      style={{ padding: '3px 9px', borderRadius: 5, cursor: 'pointer', background: 'rgba(8,8,11,0.7)', border: '1px solid var(--onyx-accent-edge)', color: 'var(--onyx-accent)', fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' }}
                    >
                      Manage
                    </div>
                  }
                />
              );
            })}
          </div>
        ) : (
          <BrowseList
            columns={[
              { id: 'name',        label: 'Playlist',    flex: 2 },
              { id: 'description', label: 'Description', flex: 2 },
              { id: 'titles',      label: 'Titles',      width: 80 },
              { id: 'manage',      label: '',            width: 80 },
            ]}
            rows={filtered.map(p => {
              const books = booksFor(p);
              return {
                key: p.id,
                onClick: () => openPlaylist(p),
                leading: books[0]
                  ? <Cover item={books[0]} size={28} serverUrl={st.serverUrl} />
                  : <div style={{ width: 28, height: 28, borderRadius: 4, background: 'var(--onyx-glass)', border: '1px dashed var(--onyx-glass-edge)' }} />,
                sort: { name: p.name, description: p.description ?? '', titles: p.items.length, manage: '' },
                cells: {
                  name:        <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 500, color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>,
                  description: <div style={{ fontSize: 12.5, color: 'var(--onyx-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description ?? ''}</div>,
                  titles:      <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>{p.items.length}</div>,
                  manage: (
                    // div with stopPropagation so clicking Manage doesn't trigger the row's openPlaylist
                    <div
                      onClick={e => { e.stopPropagation(); setDetailPlaylistId(p.id); }}
                      style={{
                        display: 'inline-flex', alignItems: 'center',
                        padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
                        border: '1px solid var(--onyx-accent-edge)',
                        color: 'var(--onyx-accent)', fontFamily: MONO, fontSize: 9,
                        letterSpacing: '0.08em', textTransform: 'uppercase',
                        userSelect: 'none',
                      }}
                    >
                      Manage
                    </div>
                  ),
                },
              };
            })}
          />
        )}
      </BrowseView>

      {detailPlaylistId && (
        <PlaylistDetail
          playlistId={detailPlaylistId}
          serverUrl={st.serverUrl}
          st={st}
          onClose={() => setDetailPlaylistId(null)}
          onUpdated={updated => {
            // Update the local playlist list so grid covers reflect the new order.
            setPlaylists(prev => prev.map(p => p.id === updated.id ? updated : p));
            // If the library shelf is currently filtered by this playlist, push
            // the new bookIds into the contextFilter so the shelf re-sorts immediately.
            if (st.contextFilter?.playlistId === updated.id) {
              st.setContextFilter({
                ...st.contextFilter,
                bookIds: updated.items.map(it => it.libraryItemId),
              });
            }
          }}
          onDeleted={() => {
            setPlaylists(prev => prev.filter(p => p.id !== detailPlaylistId));
            setDetailPlaylistId(null);
          }}
        />
      )}
    </>
  );
}
