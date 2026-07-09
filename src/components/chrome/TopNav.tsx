import { useState, useRef, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { OnyxState } from '../../state/onyx';
import type { SearchScope } from '../../lib/shelfFilters';
import { scanFolder } from '../../api/abs';
import type { ScannedItem } from '../../api/abs';
import Glass from './Glass';
import Icon from '../Icon';
import MatchModal, { makeLocalQuarantineAdapter } from '../MatchModal';
import UploadModal from '../UploadModal';
import { log } from '../../lib/log';

export interface TopNavProps {
  st: OnyxState;
}

// Display label for a library in the switcher (podcast libraries are prefixed).
function libraryLabel(l: { name: string; mediaType: string }): string {
  return l.mediaType === 'podcast' ? `Podcasts: ${l.name}` : l.name;
}

// Search field-scope options (book libraries).
const SCOPES: { value: SearchScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'series', label: 'Series' },
];

export default function TopNav({ st }: TopNavProps) {
  const mono = "'JetBrains Mono', ui-monospace, monospace";
  // Podcast search is title-only, so the field-scope selector (Title/Author/
  // Series) is hidden for podcast libraries.
  const isPodcast = st.activeLibrary?.mediaType === 'podcast';
  // Custom library dropdown (a native <select> can't be themed to match Onyx).
  const [libMenuOpen, setLibMenuOpen] = useState(false);
  const [hoverLib, setHoverLib] = useState<string | null>(null);
  const libRef = useRef<HTMLDivElement>(null);
  // Custom search field-scope dropdown (same Onyx treatment as the switcher).
  const [scopeOpen, setScopeOpen] = useState(false);
  const [hoverScope, setHoverScope] = useState<SearchScope | null>(null);
  const scopeRef = useRef<HTMLDivElement>(null);

  // ── Add books (local libraries) ─────────────────────────────────────────────
  // Pick a folder, scan it into book units, then walk each through the Match modal;
  // applying a match files the book into Author/Series/Title and catalogs it.
  const [addQueue, setAddQueue] = useState<ScannedItem[]>([]);
  const [addIndex, setAddIndex] = useState(0);
  const [addLib, setAddLib] = useState('');

  // ── Upload (ABS libraries) ──────────────────────────────────────────────────
  // The server-side counterpart of Add books: pick files → POST /api/upload.
  const [uploadOpen, setUploadOpen] = useState(false);

  const addBooks = async () => {
    const lib = st.activeLibrary;
    if (!lib || lib.source !== 'local') return;
    const picked = await open({ directory: true, multiple: false, title: 'Choose a folder of audiobooks to add' });
    const src = typeof picked === 'string' ? picked : null;
    if (!src) return; // cancelled
    try {
      const scanned = await scanFolder(src, lib.id);
      if (scanned.length === 0) {
        st.setToast({ message: 'No audiobooks found in that folder', type: 'info' });
        return;
      }
      setAddLib(lib.id);
      setAddIndex(0);
      setAddQueue(scanned);
    } catch (e) {
      log.error('library', 'add-books folder scan failed', { err: String(e) });
      st.setToast({ message: 'Could not read the selected folder', type: 'error' });
    }
  };

  useEffect(() => {
    if (!libMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (libRef.current && !libRef.current.contains(e.target as Node)) setLibMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [libMenuOpen]);

  useEffect(() => {
    if (!scopeOpen) return;
    const onDown = (e: MouseEvent) => {
      if (scopeRef.current && !scopeRef.current.contains(e.target as Node)) setScopeOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [scopeOpen]);

  // Switch the active library and reset the shelf view context so the new
  // library starts clean (no stale search/filter/tab/focus from the old one).
  const switchLibrary = (id: string) => {
    if (id === st.currentLibraryId) { st.setScreen('library'); return; }
    st.setActiveLibrary(id).catch(e => log.error('library', 'library switch failed', { id, err: String(e) }));
    st.setScreen('library');
    st.setSearch('');
    st.setContextFilter(null);
    st.setShelfTab('library');
    // Focus is scoped per library now — the target library's own focused book
    // restores automatically, so we no longer clear it on switch.
  };

  return (
    <>
    <Glass translucent={st.translucent} style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 18, overflow: 'visible', position: 'relative', zIndex: 40 }}>
      {/* Current-library chip paired with the (local-only) Add-books button. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* Current library — the prominent "you are here" indicator, and (when more
          than one library exists) the switcher. Styled as an accent chip so it
          reads as the primary anchor of the bar now that the Library tab is gone. */}
      {(() => {
        const activeLib = st.libraries.find(l => l.id === st.currentLibraryId);
        const canSwitch = st.libraries.length > 1;
        return (
          <div ref={libRef} style={{ position: 'relative' }}>
            <button
              onClick={() => {
                // Away from the shelf → return to it; already there → toggle the
                // switcher (when there's more than one library to switch to).
                if (st.screen !== 'library') { st.setScreen('library'); return; }
                if (canSwitch) setLibMenuOpen(o => !o);
              }}
              title={canSwitch ? 'Switch library' : 'Your library'}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--onyx-accent-dim)', color: 'var(--onyx-text)',
                border: '1px solid var(--onyx-accent-edge)', borderRadius: 10,
                padding: '6px 12px', cursor: 'pointer', maxWidth: 300,
              }}
            >
              <span style={{ display: 'inline-flex', color: 'var(--onyx-accent)', flexShrink: 0 }}>
                <Icon name="layers" size={15} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 0, textAlign: 'left' }}>
                <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--onyx-accent)' }}>Library</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeLib ? libraryLabel(activeLib) : 'No library'}
                </span>
              </span>
              {canSwitch && (
                <span style={{ display: 'inline-flex', color: 'var(--onyx-accent)', marginLeft: 2, flexShrink: 0, transform: libMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                  <Icon name="chevron-down" size={13} />
                </span>
              )}
            </button>
            {libMenuOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 100, minWidth: 220,
              // Frosted dark fill (panel tone, mostly opaque) behind the blur —
              // `--onyx-glass` alone is near-clear and hurts text readability over
              // the shelf, so we tint it for a frosted-but-legible menu surface.
              background: st.translucent ? 'rgba(19, 19, 22, 0.88)' : 'var(--onyx-panel)',
              backdropFilter: st.translucent ? 'blur(40px) saturate(120%)' : 'none',
              WebkitBackdropFilter: st.translucent ? 'blur(40px) saturate(120%)' : 'none',
              border: '1px solid var(--onyx-accent-edge)', borderRadius: 10,
              boxShadow: '0 24px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
              padding: 5, overflow: 'hidden',
            }}>
              {st.libraries.map(l => {
                const active = l.id === st.currentLibraryId;
                const hover = hoverLib === l.id;
                // Hover = solid accent fill ("about to pick"); current = accent
                // text + check mark ("already selected"). Distinct states.
                return (
                  <button
                    key={l.id}
                    onClick={() => { switchLibrary(l.id); setLibMenuOpen(false); }}
                    onMouseEnter={() => setHoverLib(l.id)}
                    onMouseLeave={() => setHoverLib(prev => (prev === l.id ? null : prev))}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      width: '100%', textAlign: 'left', padding: '8px 11px', borderRadius: 8,
                      background: hover ? 'var(--onyx-accent)' : 'transparent',
                      color: hover ? 'var(--onyx-bg)' : (active ? 'var(--onyx-accent)' : 'var(--onyx-text)'),
                      border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5,
                      fontWeight: active ? 600 : 500,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{libraryLabel(l)}</span>
                    {active && <Icon name="check" size={12} />}
                  </button>
                );
              })}
            </div>
            )}
          </div>
        );
      })()}
        {/* Add books — local *book* libraries only. Pick a folder → match → file.
            Local podcast libraries use the "+ Subscribe" (by RSS) affordance
            instead, so this button is hidden for them. */}
        {st.activeLibrary?.source === 'local' && st.activeLibrary?.mediaType !== 'podcast' && (
          <button
            onClick={() => void addBooks()}
            title="Add books to this library"
            style={{
              display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
              background: 'var(--onyx-accent-dim)', color: 'var(--onyx-text)',
              border: '1px solid var(--onyx-accent-edge)', borderRadius: 10,
              padding: '8px 13px', cursor: 'pointer',
            }}
          >
            <span style={{ display: 'inline-flex', color: 'var(--onyx-accent)' }}>
              <Icon name="plus" size={15} />
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Add books</span>
          </button>
        )}
        {/* Upload — ABS libraries, users with the upload permission (admin/root
            always qualify). Same slot + visual language as the local Add-books
            button; opens the Upload modal (POST /api/upload). */}
        {st.activeLibrary && st.activeLibrary.source !== 'local' && st.canUpload && (
          <button
            onClick={() => setUploadOpen(true)}
            title="Upload audiobooks to the server"
            style={{
              display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
              background: 'var(--onyx-accent-dim)', color: 'var(--onyx-text)',
              border: '1px solid var(--onyx-accent-edge)', borderRadius: 10,
              padding: '8px 13px', cursor: 'pointer',
            }}
          >
            <span style={{ display: 'inline-flex', color: 'var(--onyx-accent)' }}>
              <Icon name="upload" size={15} />
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Upload</span>
          </button>
        )}
      </div>
      <div style={{ flex: 1, marginLeft: 24, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--onyx-text-mute)', display: 'flex', pointerEvents: 'none' }}>
          <Icon name="search" size={13} />
        </div>
        <input
          id="onyx-search"
          type="text"
          placeholder={`Search ${st.library.length} titles…`}
          value={st.search}
          onChange={(e) => st.setSearch(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: isPodcast ? '8px 12px 8px 34px' : '8px 92px 8px 34px',
            background: 'rgba(0,0,0,0.3)', borderRadius: 8,
            fontSize: 12, color: 'var(--onyx-text)',
            border: '1px solid var(--onyx-line)', outline: 'none', fontFamily: 'inherit',
          }}
        />
        {/* Search scope — narrows the query to a single field (Ctrl+K still
            focuses). Hidden for podcasts, which only search by title. Custom
            dropdown (black surface; accent highlight on hover, check on current)
            to match the library switcher. */}
        {!isPodcast && (
          <div ref={scopeRef} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)' }}>
            <button
              onClick={() => setScopeOpen(o => !o)}
              title="Search field scope"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: mono, fontSize: 10, letterSpacing: '0.04em',
                background: 'var(--onyx-bg)', color: 'var(--onyx-text-dim)',
                border: '1px solid var(--onyx-glass-edge)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer',
              }}
            >
              {SCOPES.find(s => s.value === st.searchScope)?.label ?? 'All'}
              <span style={{ display: 'inline-flex', transform: scopeOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                <Icon name="chevron-down" size={10} />
              </span>
            </button>
            {scopeOpen && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 100, minWidth: 130,
                // Same frosted panel surface as the library switcher menu above:
                // tinted translucent fill behind the blur, gold accent edge, deep
                // shadow + inner highlight — so the two menus read as one family.
                background: st.translucent ? 'rgba(19, 19, 22, 0.88)' : 'var(--onyx-panel)',
                backdropFilter: st.translucent ? 'blur(40px) saturate(120%)' : 'none',
                WebkitBackdropFilter: st.translucent ? 'blur(40px) saturate(120%)' : 'none',
                border: '1px solid var(--onyx-accent-edge)', borderRadius: 10,
                boxShadow: '0 24px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
                padding: 5, overflow: 'hidden',
              }}>
                {SCOPES.map(s => {
                  const active = s.value === st.searchScope;
                  const hover = hoverScope === s.value;
                  // Hover = solid accent fill; current = accent text + check —
                  // matching the library switcher's item states exactly.
                  return (
                    <button
                      key={s.value}
                      onClick={() => { st.setSearchScope(s.value); setScopeOpen(false); }}
                      onMouseEnter={() => setHoverScope(s.value)}
                      onMouseLeave={() => setHoverScope(prev => (prev === s.value ? null : prev))}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                        width: '100%', textAlign: 'left', padding: '8px 11px', borderRadius: 8,
                        background: hover ? 'var(--onyx-accent)' : 'transparent',
                        color: hover ? 'var(--onyx-bg)' : (active ? 'var(--onyx-accent)' : 'var(--onyx-text)'),
                        border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5,
                        fontWeight: active ? 600 : 500,
                      }}
                    >
                      {s.label}
                      {active && <Icon name="check" size={12} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      {/* User avatar — initial derived from logged-in username, not hardcoded */}
      <button
        onClick={() => st.setScreen('settings')}
        title="Account & settings"
        style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'var(--onyx-accent)', color: 'var(--onyx-bg)',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}
      >{((st.user?.username || st.localDisplayName)?.[0] ?? '?').toUpperCase()}</button>
    </Glass>

    {/* Add-books flow — match each scanned book, then file it into the tree.
        Reuses the unified Match modal with the local quarantine adapter, whose
        submit (file_and_insert) moves the book into Author/Series/Title. */}
    {addIndex < addQueue.length && (
      <MatchModal
        key={addQueue[addIndex].sourcePath}
        item={addQueue[addIndex].item}
        adapter={makeLocalQuarantineAdapter(addLib, addQueue[addIndex])}
        queue={{ index: addIndex, total: addQueue.length }}
        onClose={() => { setAddQueue([]); setAddIndex(0); }}
        onComplete={() => {
          // The adapter already filed + catalogued the book. Advance through the
          // queue WITHOUT reloading the library between books — setActiveLibrary
          // flips libraryLoading, which unmounts this component (and the queue).
          // Reload once at the end, when the batch is done and the modal closes.
          const next = addIndex + 1;
          if (next >= addQueue.length) {
            const count = addQueue.length;
            setAddQueue([]);
            setAddIndex(0);
            st.setToast({ message: `Added ${count} book${count > 1 ? 's' : ''} to your library`, type: 'success' });
            if (st.currentLibraryId === addLib) st.setActiveLibrary(addLib).catch(e => log.error('library', 'reload after add-books failed', { err: String(e) }));
            else st.refreshLibrary().catch(e => log.error('library', 'refresh after add-books failed', { err: String(e) }));
          } else {
            setAddIndex(next);
          }
        }}
        onRefresh={() => {}}
      />
    )}

    {/* Upload flow — server-side item creation via POST /api/upload. */}
    {uploadOpen && <UploadModal st={st} onClose={() => setUploadOpen(false)} />}
    </>
  );
}
