import { useState, useRef, useEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { OnyxState } from '../../state/onyx';
import type { SearchScope } from '../../lib/shelfFilters';
import Glass from './Glass';
import Icon from '../Icon';
import LocalImportDialog from '../LocalImportDialog';
import UploadModal from '../UploadModal';
import { log } from '../../lib/log';
import { libraryDisplayLabel, librarySourceBadge } from '../../lib/libraryPresentation';
import { allLibrariesShelf } from '../../lib/allLibraries';

export interface TopNavProps {
  st: OnyxState;
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
  const libTriggerRef = useRef<HTMLButtonElement>(null);
  const libOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Custom search field-scope dropdown (same Onyx treatment as the switcher).
  const [scopeOpen, setScopeOpen] = useState(false);
  const [hoverScope, setHoverScope] = useState<SearchScope | null>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const scopeTriggerRef = useRef<HTMLButtonElement>(null);
  const scopeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // ── Add books (local libraries) ─────────────────────────────────────────────
  // Pick a folder, scan it into book units, then walk each through the Match modal;
  // applying a match files the book into Author/Series/Title and catalogs it.
  const [localImportOpen, setLocalImportOpen] = useState(false);

  // ── Upload (ABS libraries) ──────────────────────────────────────────────────
  // The server-side counterpart of Add books: pick files → POST /api/upload.
  const [uploadOpen, setUploadOpen] = useState(false);

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

  // Custom popouts follow one listbox contract so keyboard behavior does not
  // depend on which TopNav selector a listener happens to open.
  const focusOption = (refs: Array<HTMLButtonElement | null>, index: number) => {
    refs[index]?.focus();
  };

  const handleListboxKey = (
    event: ReactKeyboardEvent,
    refs: Array<HTMLButtonElement | null>,
    close: () => void,
    trigger: HTMLButtonElement | null,
  ) => {
    const current = refs.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      trigger?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') focusOption(refs, 0);
    else if (event.key === 'End') focusOption(refs, refs.length - 1);
    else if (event.key === 'ArrowDown') focusOption(refs, current < 0 ? 0 : (current + 1) % refs.length);
    else focusOption(refs, current <= 0 ? refs.length - 1 : current - 1);
  };

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

  const openLocalLibrarySetup = () => {
    log.info('library', 'open local library setup from shelf');
    st.setSettingsSection('library');
    st.setScreen('settings');
    setLibMenuOpen(false);
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
        const combined = allLibrariesShelf(st.libraries);
        const libraryChoices = combined ? [combined, ...st.libraries] : st.libraries;
        const activeLib = st.activeLibrary;
        const canSwitch = libraryChoices.length > 1;
        return (
          <div ref={libRef} style={{ position: 'relative' }}>
            <button
              ref={libTriggerRef}
              onClick={() => {
                // Away from the shelf → return to it; already there → toggle the
                // switcher (when there's more than one library to switch to).
                if (st.screen !== 'library') { st.setScreen('library'); return; }
                if (canSwitch) setLibMenuOpen(o => !o);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && libMenuOpen) {
                  event.preventDefault();
                  setLibMenuOpen(false);
                  return;
                }
                if (!canSwitch || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
                event.preventDefault();
                setLibMenuOpen(true);
                requestAnimationFrame(() => {
                  const activeIndex = libraryChoices.findIndex(l => l.id === st.currentLibraryId);
                  focusOption(libOptionRefs.current, activeIndex >= 0 ? activeIndex : 0);
                });
              }}
              aria-haspopup={canSwitch ? 'listbox' : undefined}
              aria-expanded={canSwitch ? libMenuOpen : undefined}
              aria-controls={canSwitch ? 'onyx-library-listbox' : undefined}
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
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeLib ? libraryDisplayLabel(activeLib) : 'No library'}
                  </span>
                  {activeLib && (
                    <span style={{ flexShrink: 0, fontFamily: mono, fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--onyx-accent)' }}>
                      {librarySourceBadge(activeLib)}
                    </span>
                  )}
                </span>
              </span>
              {canSwitch && (
                <span style={{ display: 'inline-flex', color: 'var(--onyx-accent)', marginLeft: 2, flexShrink: 0, transform: libMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                  <Icon name="chevron-down" size={13} />
                </span>
              )}
            </button>
            {libMenuOpen && (
            <div
              id="onyx-library-listbox"
              role="listbox"
              aria-label="Choose library"
              onKeyDown={(event) => handleListboxKey(event, libOptionRefs.current, () => setLibMenuOpen(false), libTriggerRef.current)}
              style={{
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
              }}
            >
              {libraryChoices.map((l, index) => {
                const active = l.id === st.currentLibraryId;
                const hover = hoverLib === l.id;
                // Hover = solid accent fill ("about to pick"); current = accent
                // text + check mark ("already selected"). Distinct states.
                return (
                  <button
                    key={l.id}
                    ref={(node) => { libOptionRefs.current[index] = node; }}
                    role="option"
                    aria-selected={active}
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
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{libraryDisplayLabel(l)}</span>
                      <span style={{ flexShrink: 0, fontFamily: mono, fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: hover ? 0.75 : 0.65 }}>
                        {librarySourceBadge(l)}
                      </span>
                    </span>
                    {active && <span style={{ flexShrink: 0 }}><Icon name="check" size={12} /></span>}
                  </button>
                );
              })}
            </div>
            )}
          </div>
        );
      })()}
        {!st.libraries.some(l => l.source === 'local') && (
          <button
            onClick={openLocalLibrarySetup}
            title="Create a library from audiobooks on this PC"
            style={{
              display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
              background: 'transparent', color: 'var(--onyx-text-dim)',
              border: '1px solid var(--onyx-glass-edge)', borderRadius: 10,
              padding: '8px 13px', cursor: 'pointer',
            }}
          >
            <span style={{ display: 'inline-flex', color: 'var(--onyx-accent)' }}><Icon name="plus" size={14} /></span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Add local library</span>
          </button>
        )}
        {/* Local book libraries share the same Files / Folder / Staging import
            dialog as onboarding and Settings. Podcasts use + Subscribe instead. */}
        {st.activeLibrary?.source === 'local' && st.activeLibrary?.mediaType !== 'podcast' && (
          <button
            onClick={() => setLocalImportOpen(true)}
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
        {st.activeLibrary && st.activeLibrary.source !== 'local' && st.activeLibrary.source !== 'all' && st.canUpload && (
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
              ref={scopeTriggerRef}
              onClick={() => setScopeOpen(o => !o)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && scopeOpen) {
                  event.preventDefault();
                  setScopeOpen(false);
                  return;
                }
                if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
                event.preventDefault();
                setScopeOpen(true);
                requestAnimationFrame(() => {
                  const activeIndex = SCOPES.findIndex(s => s.value === st.searchScope);
                  focusOption(scopeOptionRefs.current, activeIndex >= 0 ? activeIndex : 0);
                });
              }}
              aria-haspopup="listbox"
              aria-expanded={scopeOpen}
              aria-controls="onyx-search-scope-listbox"
              aria-label="Search field scope"
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
              <div
                id="onyx-search-scope-listbox"
                role="listbox"
                aria-label="Search field scope"
                onKeyDown={(event) => handleListboxKey(event, scopeOptionRefs.current, () => setScopeOpen(false), scopeTriggerRef.current)}
                style={{
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
                }}
              >
                {SCOPES.map((s, index) => {
                  const active = s.value === st.searchScope;
                  const hover = hoverScope === s.value;
                  // Hover = solid accent fill; current = accent text + check —
                  // matching the library switcher's item states exactly.
                  return (
                    <button
                      key={s.value}
                      ref={(node) => { scopeOptionRefs.current[index] = node; }}
                      role="option"
                      aria-selected={active}
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
        onClick={() => { st.setSettingsSection('account'); st.setScreen('settings'); }}
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

    {localImportOpen && st.activeLibrary?.source === 'local' && (
      <LocalImportDialog st={st} library={st.activeLibrary} onClose={() => setLocalImportOpen(false)} />
    )}

    {/* Upload flow — server-side item creation via POST /api/upload. */}
    {uploadOpen && <UploadModal st={st} onClose={() => setUploadOpen(false)} />}
    </>
  );
}
