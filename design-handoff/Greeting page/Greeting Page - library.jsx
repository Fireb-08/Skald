// Onyx — Library screen (working).
// Collapsible focus card on the left; nav bar + Pick-it-up row + grid on right.

function Library({ st }) {
  const focus = st.currentBook;
  const inProg = LIBRARY.filter(b => b.progress > 0);
  const [bookmarksOpen, setBookmarksOpen] = React.useState(false);

  // Filter + search
  const seriesName = (s) => (s || '').split(' · ')[0];
  const seriesVol = (s) => parseInt((s || '').split(' · ')[1] || '0', 10);

  // Toggle helper — sets the context filter, or clears it if already on same value.
  const toggleContext = (kind, value) => {
    if (st.contextFilter && st.contextFilter.kind === kind && st.contextFilter.value === value) {
      st.setContextFilter(null);
    } else {
      st.setContextFilter({ kind, value });
    }
  };
  const ctxIs = (kind, value) => st.contextFilter && st.contextFilter.kind === kind && st.contextFilter.value === value;

  const filtered = LIBRARY.filter(b => {
    if (st.contextFilter) {
      const { kind, value, bookIds } = st.contextFilter;
      if (kind === 'series' && seriesName(b.series) !== value) return false;
      if (kind === 'author' && b.author !== value) return false;
      if (kind === 'narrator' && b.narrator !== value) return false;
      // Collection filter: only books whose id is in the collection's bookIds.
      if (kind === 'collection' && !(bookIds || []).includes(b.id)) return false;
    }
    // Library setting: hide finished titles globally unless the user is explicitly filtering for them.
    if (!st.showFinished && b.progress >= 0.98 && st.filter !== 'finished') return false;
    if (st.filter === 'reading' && !b.progress) return false;
    if (st.filter === 'unread' && b.progress) return false;
    if (st.filter === 'finished' && b.progress < 0.98) return false;
    if (st.search) {
      const q = st.search.toLowerCase();
      if (!b.title.toLowerCase().includes(q) && !b.author.toLowerCase().includes(q) && !(b.series || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
  // When filtering by series, sort by volume number so the order reads as a series.
  if (st.contextFilter?.kind === 'series') {
    filtered.sort((a, b) => seriesVol(a.series) - seriesVol(b.series));
  } else {
    // Library setting: default sort.
    if (st.librarySort === 'title') filtered.sort((a, b) => a.title.localeCompare(b.title));
    else if (st.librarySort === 'author') filtered.sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
    else if (st.librarySort === 'most-listened') filtered.sort((a, b) => (b.progress || 0) - (a.progress || 0));
    // 'recently' — LIBRARY order is already "recently added"; leave as-is.
  }
  // Library setting: group by series — collapse multi-volume series to their first matching volume.
  // Skip when the user is already drilling into a single series (the volume list is the point there).
  let shelfBooks = filtered;
  if (st.groupBySeries && st.contextFilter?.kind !== 'series') {
    const seen = new Set();
    shelfBooks = filtered.filter(b => {
      const name = seriesName(b.series);
      if (!name) return true;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }

  // Library setting: cover size — maps to tile width + grid track minimum.
  const COVER_SIZES = { S: 80, M: 96, L: 116, XL: 148 };
  const coverW = COVER_SIZES[st.coverSize] || COVER_SIZES.L;

  const totalSecs = st.bookSecs;
  const focusProgress = st.currentBookId === focus.id ? st.position / totalSecs : focus.progress;
  const remaining = st.currentBookId === focus.id ? totalSecs - st.position : totalSecs * (1 - focus.progress);
  const { idx: chIdx, chapter: curCh } = chapterAt(st.position);

  const openBook = (id) => {
    st.setCurrentBookId(id);
    if (id !== st.currentBookId) {
      // jump to the book's saved progress
      const b = LIBRARY.find(x => x.id === id);
      st.setPosition((b?.progress || 0) * parseDur(b?.dur || '0h 0m'));
    }
    st.setScreen('player');
  };

  return (
    <div style={{ flex: 1, display: 'flex', gap: 24, padding: '8px 24px 24px', minHeight: 0 }}>
      {/* LEFT — Focus card or collapsed strip */}
      {!st.focusCollapsed ? (
        <Glass style={{ width: 360, padding: 28, display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'relative' }}>
          {/* Collapse handle */}
          <button onClick={() => st.setFocusCollapsed(true)} title="Collapse panel" style={{
            position: 'absolute', top: 12, bottom: 12, right: -1, width: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', zIndex: 5,
          }}>
            <div style={{
              width: 4, height: '100%', borderRadius: 2,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(212,166,74,0.22) 30%, rgba(212,166,74,0.22) 70%, rgba(255,255,255,0.04))',
              border: `1px solid ${ONYX.glassEdge}`,
              position: 'relative',
            }}>
              <div style={{
                position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                width: 22, height: 44, borderRadius: 11,
                background: ONYX.panel2, border: `1px solid ${ONYX.glassEdge}`,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: ONYX.accent,
              }}>
                <Icon name="chevron-left" size={12} />
              </div>
            </div>
          </button>

          <div style={{ fontFamily: ONYX.mono, fontSize: 10, letterSpacing: '0.18em', color: ONYX.textMute, textTransform: 'uppercase', marginBottom: 16 }}>In focus</div>

          <div onClick={() => openBook(focus.id)} style={{ cursor: 'pointer' }}>
            <Cover book={focus} w={300} />
          </div>

          <button onClick={() => toggleContext('series', seriesName(focus.series))} title={ctxIs('series', seriesName(focus.series)) ? 'Clear series filter' : `Show all books in ${seriesName(focus.series)}`} style={{
            marginTop: 22, alignSelf: 'flex-start',
            fontFamily: ONYX.mono, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: ONYX.accent, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {focus.series}
            <Icon name={ctxIs('series', seriesName(focus.series)) ? 'chevron-down' : 'chevron-right'} size={10} style={{ opacity: 0.7 }} />
          </button>
          <div style={{ marginTop: 6, fontFamily: ONYX.serif, fontSize: 30, fontWeight: 500, lineHeight: 1.05, letterSpacing: '-0.01em' }}>{focus.title}</div>
          <div style={{ marginTop: 8, fontSize: 14, color: ONYX.textDim, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 4px' }}>
            <span>by</span>
            <button onClick={() => toggleContext('author', focus.author)} title={ctxIs('author', focus.author) ? 'Clear author filter' : `Show all books by ${focus.author}`} style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 'inherit',
              color: ctxIs('author', focus.author) ? ONYX.accent : ONYX.text,
              borderBottom: `1px dashed ${ctxIs('author', focus.author) ? ONYX.accent : 'rgba(235,231,223,0.25)'}`,
            }}>{focus.author}</button>
            <span style={{ color: ONYX.textMute }}>·</span>
            <button onClick={() => toggleContext('narrator', focus.narrator)} title={ctxIs('narrator', focus.narrator) ? 'Clear narrator filter' : `Show all books narrated by ${focus.narrator}`} style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 'inherit',
              color: ctxIs('narrator', focus.narrator) ? ONYX.accent : ONYX.textDim,
              borderBottom: `1px dashed ${ctxIs('narrator', focus.narrator) ? ONYX.accent : 'rgba(235,231,223,0.15)'}`,
            }}>{focus.narrator}</button>
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
            <button onClick={() => { st.setPlaying(p => !p); openBook(focus.id); }} style={{
              flex: 1, height: 44, background: ONYX.accent, color: ONYX.bg,
              border: 'none', borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <Icon name={st.playing && st.currentBookId === focus.id ? 'pause' : 'play'} size={14} />
              {st.playing && st.currentBookId === focus.id ? 'Pause' : 'Continue'} · {fmtRemaining(remaining)}
            </button>
            <button style={{ width: 44, height: 44, background: ONYX.glassStrong, border: `1px solid ${ONYX.glassEdge}`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ONYX.textDim, cursor: 'pointer' }} title="Bookmark this book">
              <Icon name="bookmark" size={16} />
            </button>
          </div>

          <div style={{ marginTop: 14, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${focusProgress * 100}%`, height: '100%', background: ONYX.accent, transition: 'width 0.2s' }} />
          </div>
          <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, letterSpacing: '0.06em' }}>
            <span>{Math.round(focusProgress * 100)}% · Ch. {chIdx + 1} / {CHAPTERS.length}</span>
            <button onClick={() => setBookmarksOpen(o => !o)} title="Show bookmarks" style={{
              fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit',
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: bookmarksOpen ? ONYX.accent : ONYX.textMute,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              Bookmarked {BOOKMARKS.length}×
              <Icon name={bookmarksOpen ? 'chevron-down' : 'chevron-right'} size={9} />
            </button>
          </div>

          {/* Inline bookmark list — fills the empty space when toggled open */}
          {bookmarksOpen ? (
            <div style={{
              marginTop: 14, padding: '12px 12px 4px',
              background: 'rgba(0,0,0,0.25)',
              border: `1px solid ${ONYX.line}`,
              borderRadius: 10,
              animation: 'onyx-fadein 0.18s ease-out',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Icon name="bookmark" size={11} style={{ color: ONYX.accent }} />
                <div style={{ fontFamily: ONYX.mono, fontSize: 9.5, color: ONYX.textMute, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Bookmarks</div>
                <button style={{ marginLeft: 'auto', fontFamily: ONYX.mono, fontSize: 9.5, color: ONYX.accent, letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, padding: 0 }}>
                  <Icon name="plus" size={10} /> ADD
                </button>
              </div>
              {BOOKMARKS.map((bm, i) => (
                <button key={i} onClick={() => {
                  st.setPosition(chapterStart(bm.ch - 1) + bm.secs);
                  st.setScreen('player');
                }} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0',
                  background: 'none', border: 'none',
                  borderTop: i > 0 ? `1px solid ${ONYX.line}` : 'none',
                  width: '100%', cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'inherit', color: 'inherit',
                }}>
                  <div style={{ fontFamily: ONYX.mono, fontSize: 10.5, fontWeight: 600, color: ONYX.accent, paddingTop: 1, flexShrink: 0 }}>{bm.ts}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: ONYX.text, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{bm.label}</div>
                    <div style={{ fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2 }}>Ch. {bm.ch} · {bm.date}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : focus.synopsis ? (
            // Synopsis — shown when the bookmark drawer is closed.
            // Editorial paragraph in serif, with a drop-cap-ish opening flourish.
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${ONYX.line}` }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <div style={{ fontFamily: ONYX.mono, fontSize: 9.5, color: ONYX.textMute, letterSpacing: '0.16em', textTransform: 'uppercase' }}>Synopsis</div>
              </div>
              <div style={{
                fontFamily: ONYX.serif, fontSize: 13.5, lineHeight: 1.55, color: ONYX.textDim,
                textWrap: 'pretty',
              }}>
                {focus.synopsis}
              </div>
            </div>
          ) : null}

          <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: `1px solid ${ONYX.line}`, display: 'flex', gap: 24 }}>
            <Stat label="Duration" value={focus.dur} />
            <ChaptersStat st={st} chIdx={chIdx} />
            <SpeedStat st={st} />
          </div>
        </Glass>
      ) : (
        // Collapsed strip
        <Glass style={{ width: 76, padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, position: 'relative', gap: 18 }}>
          <button onClick={() => st.setFocusCollapsed(false)} title="Expand panel" style={{
            position: 'absolute', top: 12, bottom: 12, right: -1, width: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', zIndex: 5,
          }}>
            <div style={{
              width: 4, height: '100%', borderRadius: 2,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(212,166,74,0.22) 30%, rgba(212,166,74,0.22) 70%, rgba(255,255,255,0.04))',
              border: `1px solid ${ONYX.glassEdge}`,
              position: 'relative',
            }}>
              <div style={{
                position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                width: 22, height: 44, borderRadius: 11,
                background: ONYX.panel2, border: `1px solid ${ONYX.glassEdge}`,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: ONYX.accent,
              }}>
                <Icon name="chevron-right" size={12} />
              </div>
            </div>
          </button>
          <div onClick={() => openBook(focus.id)} style={{ cursor: 'pointer' }}>
            <Cover book={focus} w={48} />
          </div>
          <button onClick={() => { st.setPlaying(p => !p); openBook(focus.id); }} style={{
            width: 32, height: 32, borderRadius: 16, border: 'none',
            background: ONYX.accent, color: ONYX.bg, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={st.playing && st.currentBookId === focus.id ? 'pause' : 'play'} size={12} />
          </button>
          <div style={{ width: 2, flex: 1, background: 'rgba(255,255,255,0.08)', borderRadius: 1, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${focusProgress * 100}%`, background: ONYX.accent }} />
          </div>
          <div style={{ fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, writingMode: 'vertical-rl', transform: 'rotate(180deg)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{focus.title}</div>
        </Glass>
      )}

      {/* RIGHT */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
        <TopNav st={st} />

        {/* Pick it up — always visible across shelf tabs so the user can resume current listening
            from any catalog view. Still hidden when actively filtering / searching. Collapsible. */}
        {inProg.length > 0 && st.filter === 'all' && !st.search && !st.contextFilter && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '0 4px 12px' }}>
              <button
                onClick={() => st.setPickItUpCollapsed(!st.pickItUpCollapsed)}
                title={st.pickItUpCollapsed ? 'Expand Pick it up' : 'Collapse Pick it up'}
                style={{ display: 'flex', alignItems: 'baseline', gap: 12, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' }}
              >
                <div style={{ fontFamily: ONYX.serif, fontSize: 24, fontWeight: 500, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="chevron-down" size={13} style={{ color: ONYX.textMute, transform: st.pickItUpCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.18s' }} />
                  Pick it up
                </div>
                <div style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{inProg.length} in progress</div>
              </button>
            </div>
            {!st.pickItUpCollapsed && (
              <div style={{ display: 'flex', gap: 14 }}>
                {inProg.map(b => (
                  <Glass key={b.id} onClick={() => openBook(b.id)} style={{ flex: 1, padding: 14, display: 'flex', gap: 14, minHeight: 110, cursor: 'pointer' }}>
                    <Cover book={b} w={80} />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{b.series}</div>
                      <div style={{ marginTop: 4, fontFamily: ONYX.serif, fontSize: 17, fontWeight: 500, lineHeight: 1.1 }}>{b.title}</div>
                      <div style={{ marginTop: 2, fontSize: 12, color: ONYX.textDim }}>{b.author}</div>
                      <div style={{ flex: 1 }} />
                      <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${b.progress * 100}%`, height: '100%', background: ONYX.accent }} />
                      </div>
                      <div style={{ marginTop: 4, fontFamily: ONYX.mono, fontSize: 9.5, color: ONYX.textMute, letterSpacing: '0.06em', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{Math.round(b.progress * 100)}%</span><span>{b.dur}</span>
                      </div>
                    </div>
                  </Glass>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Library shelf — existing grid/list. Other shelf tabs render below. */}
        {st.shelfTab === 'library' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 4px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0, flexShrink: 0 }}>
              <div style={{ fontFamily: ONYX.serif, fontSize: 24, fontWeight: 500, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {st.contextFilter ? st.contextFilter.value : 'The shelf'}
              </div>
              <div style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                {filtered.length} title{filtered.length === 1 ? '' : 's'}{st.search ? ` matching "${st.search}"` : ''}
                {st.contextFilter?.kind === 'series'
                  ? ' · sort: volume order'
                  : ` · sort: ${({ recently: 'recently added', title: 'title', author: 'author', 'most-listened': 'most listened' })[st.librarySort] || 'recently added'}`}
                {st.groupBySeries && st.contextFilter?.kind !== 'series' && shelfBooks.length !== filtered.length ? ` · ${shelfBooks.length} series grouped` : ''}
              </div>
              {st.contextFilter && (
                <button onClick={() => st.setContextFilter(null)} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 10px',
                  background: ONYX.accentDim, border: `1px solid ${ONYX.accentEdge}`, borderRadius: 999,
                  fontFamily: ONYX.mono, fontSize: 10, color: ONYX.accent, letterSpacing: '0.06em', textTransform: 'uppercase',
                  cursor: 'pointer',
                }}>
                  <span style={{ fontSize: 9, opacity: 0.7 }}>{st.contextFilter.kind.toUpperCase()}</span>
                  {st.contextFilter.value}
                  <span style={{ fontSize: 13, marginLeft: 2, lineHeight: 1 }}>×</span>
                </button>
              )}
            </div>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
              <ShelfTabs st={st} />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: ONYX.mono, fontSize: 10, flexShrink: 0 }}>
              {/* Grid / List toggle */}
              <div style={{
                display: 'flex', padding: 3, gap: 2, marginRight: 6,
                background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`, borderRadius: 8,
              }}>
                {[{ id: 'grid', icon: 'grid', label: 'Grid view' }, { id: 'list', icon: 'list', label: 'List view' }].map(m => {
                  const active = st.libraryView === m.id;
                  return (
                    <button key={m.id} onClick={() => st.setLibraryView(m.id)} title={m.label} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 26, height: 22, padding: 0,
                      borderRadius: 5, cursor: 'pointer', border: 'none',
                      background: active ? ONYX.accentDim : 'transparent',
                      color: active ? ONYX.accent : ONYX.textDim,
                    }}>
                      <Icon name={m.icon} size={12} />
                    </button>
                  );
                })}
              </div>
              {[
                { id: 'all', l: 'All' },
                { id: 'reading', l: 'Reading' },
                { id: 'unread', l: 'Unread' },
                { id: 'finished', l: 'Finished' },
              ].map(f => (
                <button key={f.id} onClick={() => st.setFilter(f.id)} style={{
                  padding: '5px 10px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                  background: st.filter === f.id ? ONYX.accentDim : 'transparent',
                  border: `1px solid ${st.filter === f.id ? ONYX.accentEdge : 'transparent'}`,
                  color: st.filter === f.id ? ONYX.accent : ONYX.textMute,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>{f.l}</button>
              ))}
            </div>
          </div>
          <Glass style={{ flex: 1, padding: st.libraryView === 'list' ? '12px 14px' : '20px 18px', overflow: 'auto' }}>
            {st.libraryView === 'list' ? (
              <ShelfList books={shelfBooks} st={st} openBook={openBook} />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${coverW}px, 1fr))`, gap: 14 }}>
              {shelfBooks.map(b => (
                <button key={b.id} onClick={() => openBook(b.id)} className="onyx-tile" style={{ position: 'relative', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit' }}>
                  <div style={{ position: 'relative', transform: b.id === st.currentBookId ? 'translateY(-4px)' : 'none', filter: b.id === st.currentBookId ? 'drop-shadow(0 12px 24px rgba(212,166,74,0.35))' : 'none', transition: 'transform 0.15s, filter 0.15s' }}>
                    <Cover book={b} w={coverW} />
                    {b.id === st.currentBookId && (
                      <div style={{ position: 'absolute', inset: 0, border: `2px solid ${ONYX.accent}`, borderRadius: 4, pointerEvents: 'none' }} />
                    )}
                    {st.showProgressOverlay && b.progress > 0 && (
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: 'rgba(0,0,0,0.4)' }}>
                        <div style={{ width: `${b.progress * 100}%`, height: '100%', background: ONYX.accent }} />
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 7, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: ONYX.text }}>{b.title}</div>
                  <div style={{ marginTop: 1, fontSize: 10.5, color: ONYX.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</div>
                </button>
              ))}
              {shelfBooks.length === 0 && (
                <div style={{ gridColumn: '1 / -1', padding: '60px 0', textAlign: 'center', color: ONYX.textMute, fontFamily: ONYX.serif, fontSize: 16, fontStyle: 'italic' }}>
                  No titles match "{st.search}".
                </div>
              )}
            </div>
            )}
          </Glass>
        </div>
        )}

        {/* Browse tabs — render the corresponding catalog view inside the shelf pane */}
        {st.shelfTab === 'series' && <SeriesView st={st} inline />}
        {st.shelfTab === 'authors' && <AuthorsView st={st} inline />}
        {st.shelfTab === 'narrators' && <NarratorsView st={st} inline />}
        {st.shelfTab === 'collections' && <CollectionsView st={st} inline />}
      </div>
    </div>
  );
}

// ShelfTabs — the in-pane tab bar that swaps the shelf content between
// the user's library and the catalog browse modes (Series / Authors /
// Narrators / Collections).
function ShelfTabs({ st }) {
  const tabs = [
    { id: 'library', label: 'Home' },
    { id: 'series', label: 'Series' },
    { id: 'authors', label: 'Authors' },
    { id: 'narrators', label: 'Narrators' },
    { id: 'collections', label: 'Collections' },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4, padding: '4px',
      background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`,
      borderRadius: 10, alignSelf: 'flex-start',
    }}>
      {tabs.map(t => {
        const active = st.shelfTab === t.id;
        return (
          <button key={t.id} onClick={() => st.setShelfTab(t.id)} style={{
            padding: '7px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
            background: active ? ONYX.accentDim : 'transparent',
            border: `1px solid ${active ? ONYX.accentEdge : 'transparent'}`,
            color: active ? ONYX.accent : ONYX.textDim,
            fontSize: 12.5, fontWeight: active ? 600 : 500,
          }}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function Stat({ label, value }) {
  // Padding matches ChaptersStat/SpeedStat buttons so all three labels in the
  // focus-card footer share the same baseline.
  return (
    <div style={{ padding: '4px 10px 6px' }}>
      <div style={{ fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 16, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

// Clickable Chapters stat — opens a scrollable popover with the chapter list.
function ChaptersStat({ st, chIdx }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const listRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // when opening, scroll the current chapter into view
  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector('[data-current="true"]');
    el?.scrollIntoView({ block: 'center' });
  }, [open]);

  const jump = (i) => { st.setPosition(chapterStart(i)); setOpen(false); st.setScreen('player'); };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="Jump to chapter" style={{
        background: open ? ONYX.accentDim : 'transparent',
        border: `1px solid ${open ? ONYX.accentEdge : 'transparent'}`,
        borderRadius: 8, padding: '4px 10px 6px', cursor: 'pointer',
        textAlign: 'left', fontFamily: 'inherit', color: 'inherit',
        display: 'flex', alignItems: 'baseline', gap: 6,
      }}>
        <div>
          <div style={{ fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Chapters</div>
          <div style={{ marginTop: 3, fontSize: 16, fontWeight: 500, color: open ? ONYX.accent : ONYX.text }}>{CHAPTERS.length}</div>
        </div>
        <Icon name="chevron-down" size={10} style={{ color: ONYX.textMute, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', alignSelf: 'center', marginTop: 8 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: -4,
          width: 340, maxHeight: 420,
          background: ONYX.panel2, border: `1px solid ${ONYX.line}`, borderRadius: 10,
          boxShadow: '0 16px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(212,166,74,0.08)',
          padding: 6, zIndex: 100,
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 8px 4px' }}>
            <div style={{ fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Jump to chapter</div>
            <div style={{ marginLeft: 'auto', fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.08em' }}>{CHAPTERS.length} TOTAL</div>
          </div>
          <div ref={listRef} style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
            {CHAPTERS.map((c, i) => {
              const state = i < chIdx ? 'done' : i === chIdx ? 'playing' : 'next';
              return (
                <button key={c.n} data-current={state === 'playing'} onClick={() => jump(i)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6,
                  background: state === 'playing' ? ONYX.accentDim : 'transparent',
                  border: 'none', width: '100%', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                  marginBottom: 1,
                }}>
                  <div style={{ fontFamily: ONYX.mono, fontSize: 10, color: state === 'playing' ? ONYX.accent : ONYX.textMute, width: 22, flexShrink: 0 }}>{String(c.n).padStart(2, '0')}</div>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: state === 'playing' ? 600 : 400, color: state === 'done' ? ONYX.textMute : state === 'playing' ? ONYX.accent : ONYX.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.t}</div>
                  <div style={{ fontFamily: ONYX.mono, fontSize: 9.5, color: ONYX.textMute, flexShrink: 0 }}>{fmtTime(c.dur)}</div>
                  {state === 'done' && <Icon name="check" size={10} style={{ color: ONYX.textMute, flexShrink: 0 }} />}
                  {state === 'playing' && <div style={{ width: 5, height: 5, borderRadius: 3, background: ONYX.accent, boxShadow: `0 0 10px ${ONYX.accent}`, flexShrink: 0 }} />}
                  {state === 'next' && <div style={{ width: 10, flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Clickable Speed stat — opens a small popover with the speed presets.
function SpeedStat({ st }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="Change playback speed" style={{
        background: open ? ONYX.accentDim : 'transparent',
        border: `1px solid ${open ? ONYX.accentEdge : 'transparent'}`,
        borderRadius: 8, padding: '4px 10px 6px', cursor: 'pointer',
        textAlign: 'left', fontFamily: 'inherit', color: 'inherit',
        display: 'flex', alignItems: 'baseline', gap: 6,
      }}>
        <div>
          <div style={{ fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Speed</div>
          <div style={{ marginTop: 3, fontSize: 16, fontWeight: 500, color: open ? ONYX.accent : ONYX.text }}>{st.speed}×</div>
        </div>
        <Icon name="chevron-down" size={10} style={{ color: ONYX.textMute, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', alignSelf: 'center', marginTop: 8 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: -4,
          background: ONYX.panel2, border: `1px solid ${ONYX.line}`, borderRadius: 10,
          boxShadow: '0 16px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(212,166,74,0.08)',
          padding: 6, zIndex: 100, minWidth: 130,
        }}>
          <div style={{ fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.12em', padding: '6px 8px 4px', textTransform: 'uppercase' }}>Playback Speed</div>
          {SPEEDS.map(s => (
            <button key={s} onClick={() => { st.setSpeed(s); setOpen(false); }} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6,
              background: s === st.speed ? ONYX.accentDim : 'transparent',
              border: 'none', width: '100%', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            }}>
              <span style={{ fontFamily: ONYX.mono, fontSize: 13, color: s === st.speed ? ONYX.accent : ONYX.text, fontWeight: s === st.speed ? 600 : 400, flex: 1 }}>{s}×</span>
              {s === st.speed && <Icon name="check" size={11} style={{ color: ONYX.accent }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Wide-row list view of the shelf. Columns: cover thumb · title/series · author · genre · narrator · duration.
// Click a row to open the book. Click a column header to sort by that column;
// click again to flip direction. Current book highlighted with an accent edge + brass tint.
function ShelfList({ books, st, openBook }) {
  // Local sort overrides the library-settings default. Cleared (null) = honor inbound order.
  const [sort, setSort] = React.useState(null); // { col, dir }
  const onHeader = (col) => {
    if (sort?.col === col) setSort({ col, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    else setSort({ col, dir: 'asc' });
  };

  const sorted = React.useMemo(() => {
    if (!sort) return books;
    const key = sort.col;
    const dir = sort.dir === 'asc' ? 1 : -1;
    const get = (b) => {
      switch (key) {
        case 'title': return b.title || '';
        case 'author': return b.author || '';
        case 'genre': return b.genre || '';
        case 'narrator': return b.narrator || '';
        case 'duration': return parseDur(b.dur || '0h 0m');
        default: return '';
      }
    };
    const out = books.slice();
    out.sort((a, b) => {
      const av = get(a), bv = get(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return out;
  }, [books, sort]);

  if (sorted.length === 0) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: ONYX.textMute, fontFamily: ONYX.serif, fontSize: 16, fontStyle: 'italic' }}>
        No titles match "{st.search}".
      </div>
    );
  }
  // Header + rows. Grid: cover | title | author | genre | narrator | duration.
  const grid = '52px minmax(220px, 2.2fr) minmax(140px, 1.4fr) minmax(110px, 1fr) minmax(140px, 1.4fr) 80px';
  const COLS = [
    { id: 'title', label: 'Title', align: 'left' },
    { id: 'author', label: 'Author', align: 'left' },
    { id: 'genre', label: 'Genre', align: 'left' },
    { id: 'narrator', label: 'Narrator', align: 'left' },
    { id: 'duration', label: 'Duration', align: 'right' },
  ];
  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: grid, alignItems: 'center', gap: 14,
        padding: '8px 12px 10px', borderBottom: `1px solid ${ONYX.line}`,
      }}>
        <div />
        {COLS.map(c => {
          const active = sort?.col === c.id;
          return (
            <button key={c.id} onClick={() => onHeader(c.id)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start',
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontFamily: ONYX.mono, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: active ? ONYX.accent : ONYX.textMute,
              textAlign: c.align,
            }}>
              {c.label}
              <SortIndicator active={active} dir={sort?.dir} />
            </button>
          );
        })}
      </div>
      {sorted.map((b, i) => {
        const active = b.id === st.currentBookId;
        return (
          <button
            key={b.id}
            onClick={() => openBook(b.id)}
            className="onyx-row"
            style={{
              display: 'grid', gridTemplateColumns: grid, alignItems: 'center', gap: 14,
              padding: '8px 12px', width: '100%', textAlign: 'left',
              background: active ? ONYX.accentDim : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)'),
              border: 'none',
              borderTop: i === 0 ? 'none' : `1px solid ${ONYX.line}`,
              borderLeft: active ? `2px solid ${ONYX.accent}` : '2px solid transparent',
              cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
              position: 'relative',
            }}
          >
            <div style={{ position: 'relative' }}>
              <Cover book={b} w={40} />
              {st.showProgressOverlay && b.progress > 0 && (
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'rgba(0,0,0,0.4)' }}>
                  <div style={{ width: `${b.progress * 100}%`, height: '100%', background: ONYX.accent }} />
                </div>
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: ONYX.serif, fontSize: 14.5, fontWeight: 500, color: active ? ONYX.accent : ONYX.text, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</div>
              {b.series && (
                <div style={{ marginTop: 2, fontFamily: ONYX.mono, fontSize: 9.5, color: ONYX.textMute, letterSpacing: '0.1em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.series}</div>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: ONYX.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</div>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {b.genre ? (
                <span style={{
                  display: 'inline-block',
                  padding: '2px 8px', borderRadius: 999,
                  background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`,
                  fontFamily: ONYX.mono, fontSize: 9.5, color: ONYX.textDim, letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>{b.genre}</span>
              ) : <span style={{ color: ONYX.textMute }}>—</span>}
            </div>
            <div style={{ fontSize: 12.5, color: ONYX.textDim, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <Icon name="headphones" size={11} style={{ color: ONYX.textMute, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.narrator}</span>
            </div>
            <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.textMute, textAlign: 'right' }}>{b.dur}</div>
          </button>
        );
      })}
    </div>
  );
}

// Compact ascending/descending chevron pair used by sortable column headers.
function SortIndicator({ active, dir }) {
  return (
    <svg width="9" height="11" viewBox="0 0 9 11" style={{ flexShrink: 0, opacity: active ? 1 : 0.25 }}>
      <path d="M4.5 1 L1 5 L8 5 Z" fill={active && dir === 'asc' ? 'currentColor' : 'rgba(235,231,223,0.3)'} />
      <path d="M4.5 10 L1 6 L8 6 Z" fill={active && dir === 'desc' ? 'currentColor' : 'rgba(235,231,223,0.3)'} />
    </svg>
  );
}

Object.assign(window, { Library, ShelfTabs });
