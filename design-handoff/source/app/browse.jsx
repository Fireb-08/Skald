// Onyx — Browse views: Series, Authors, Narrators, Collections, Home.
// All driven off the LIBRARY data; aggregated on the fly.

function seriesNameOf(s) { return (s || '').split(' · ')[0]; }
function seriesVolOf(s) { return parseInt((s || '').split(' · ')[1] || '0', 10); }

// --- Series view ----------------------------------------------------------
function SeriesView({ st, inline = false }) {
  // group by series name
  const groups = {};
  for (const b of LIBRARY) {
    const name = seriesNameOf(b.series);
    if (!name) continue;
    if (!groups[name]) groups[name] = [];
    groups[name].push(b);
  }
  let seriesList = Object.entries(groups)
    .map(([name, books]) => ({ name, books: books.slice().sort((a, b) => seriesVolOf(a.series) - seriesVolOf(b.series)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Top-nav search applies within this pane — matches series name, lead author, or any volume title.
  if (st.search) {
    const q = st.search.toLowerCase();
    seriesList = seriesList.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.books.some(b => b.author.toLowerCase().includes(q) || b.title.toLowerCase().includes(q))
    );
  }

  const openSeries = (name) => {
    st.setContextFilter({ kind: 'series', value: name });
    st.setShelfTab('library');
    st.setScreen('library');
  };

  return (
    <BrowseView st={st} title="Series" subtitle={`${seriesList.length} series in your library`} showModeToggle inline={inline}>
      {st.libraryView === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}>
          {seriesList.map(s => (
            <button key={s.name} onClick={() => openSeries(s.name)} className="onyx-poster" style={posterTile()}>
              <CoverFan books={s.books.slice(0, 5)} />
              <div style={{ padding: '18px 16px 16px', textAlign: 'center' }}>
                <div style={{ fontFamily: ONYX.serif, fontSize: 22, fontWeight: 500, lineHeight: 1.1, color: ONYX.text, letterSpacing: '-0.01em' }}>{s.name}</div>
                <div style={{ fontSize: 13, color: ONYX.textDim, marginTop: 6, fontStyle: 'italic' }}>{s.books[0].author}</div>
                <div style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${ONYX.line}` }}>
                  {s.books.length} {s.books.length === 1 ? 'VOLUME' : 'VOLUMES'} <span style={{ opacity: 0.5, margin: '0 6px' }}>·</span> {seriesTotalDur(s.books)}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <BrowseList
          columns={[
            { id: 'name', label: 'Series', flex: 2 },
            { id: 'author', label: 'Author', flex: 1.5 },
            { id: 'vols', label: 'Volumes', width: 90 },
            { id: 'dur', label: 'Duration', width: 110 },
          ]}
          rows={seriesList.map(s => ({
            key: s.name,
            onClick: () => openSeries(s.name),
            leading: <Cover book={s.books[0]} w={28} />,
            sort: {
              name: s.name,
              author: s.books[0].author,
              vols: s.books.length,
              dur: s.books.reduce((acc, b) => acc + parseDur(b.dur), 0),
            },
            cells: {
              name: <div style={{ fontFamily: ONYX.serif, fontSize: 14, fontWeight: 500, color: ONYX.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>,
              author: <div style={{ fontSize: 13, color: ONYX.textDim }}>{s.books[0].author}</div>,
              vols: <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.textMute }}>{s.books.length}</div>,
              dur: <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.textMute }}>{seriesTotalDur(s.books)}</div>,
            },
          }))}
        />
      )}
    </BrowseView>
  );
}

// --- Authors view ---------------------------------------------------------
function AuthorsView({ st, inline = false }) {
  const groups = {};
  for (const b of LIBRARY) {
    if (!groups[b.author]) groups[b.author] = [];
    groups[b.author].push(b);
  }
  let list = Object.entries(groups)
    .map(([name, books]) => ({ name, books }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (st.search) {
    const q = st.search.toLowerCase();
    list = list.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.books.some(b => b.title.toLowerCase().includes(q))
    );
  }

  const open = (name) => {
    st.setContextFilter({ kind: 'author', value: name });
    st.setShelfTab('library');
    st.setScreen('library');
  };

  return (
    <BrowseView st={st} title="Authors" subtitle={`${list.length} authors in your library`} showModeToggle inline={inline}>
      {st.libraryView === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}>
          {list.map(a => {
            const genres = [...new Set(a.books.map(b => b.genre).filter(Boolean))];
            return (
              <button key={a.name} onClick={() => open(a.name)} className="onyx-poster" style={posterTile()}>
                <CoverMosaic books={a.books} />
                <div style={{ padding: '18px 16px 16px', textAlign: 'center' }}>
                  <div style={{ fontFamily: ONYX.serif, fontSize: 22, fontWeight: 500, lineHeight: 1.1, letterSpacing: '-0.01em' }}>{a.name}</div>
                  <div style={{ fontSize: 13, color: ONYX.textDim, marginTop: 6, fontStyle: 'italic' }}>{genres.join(' · ') || '—'}</div>
                  <div style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${ONYX.line}` }}>
                    {a.books.length} TITLE{a.books.length === 1 ? '' : 'S'} <span style={{ opacity: 0.5, margin: '0 6px' }}>·</span> {seriesTotalDur(a.books)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <BrowseList
          columns={[
            { id: 'name', label: 'Author', flex: 2 },
            { id: 'titles', label: 'Titles', width: 80 },
            { id: 'dur', label: 'Duration', width: 110 },
          ]}
          rows={list.map(a => ({
            key: a.name,
            onClick: () => open(a.name),
            leading: <Initial name={a.name} small />,
            sort: {
              name: a.name,
              titles: a.books.length,
              dur: a.books.reduce((acc, b) => acc + parseDur(b.dur), 0),
            },
            cells: {
              name: <div style={{ fontFamily: ONYX.serif, fontSize: 14, fontWeight: 500 }}>{a.name}</div>,
              titles: <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.textMute }}>{a.books.length}</div>,
              dur: <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.textMute }}>{seriesTotalDur(a.books)}</div>,
            },
          }))}
        />
      )}
    </BrowseView>
  );
}

// --- Narrators view -------------------------------------------------------
function NarratorsView({ st, inline = false }) {
  const groups = {};
  for (const b of LIBRARY) {
    const key = b.narrator || 'Unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(b);
  }
  let list = Object.entries(groups)
    .map(([name, books]) => ({ name, books }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (st.search) {
    const q = st.search.toLowerCase();
    list = list.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.books.some(b => b.title.toLowerCase().includes(q))
    );
  }

  const open = (name) => {
    st.setContextFilter({ kind: 'narrator', value: name });
    st.setShelfTab('library');
    st.setScreen('library');
  };

  return (
    <BrowseView st={st} title="Narrators" subtitle={`${list.length} narrators · vocal performances in your library`} showModeToggle inline={inline}>
      {st.libraryView === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}>
          {list.map(a => {
            const genres = [...new Set(a.books.map(b => b.genre).filter(Boolean))];
            return (
              <button key={a.name} onClick={() => open(a.name)} className="onyx-poster" style={posterTile()}>
                <CoverMosaic books={a.books} />
                <div style={{ padding: '18px 16px 16px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <Icon name="headphones" size={13} style={{ color: ONYX.textMute }} />
                    <div style={{ fontFamily: ONYX.serif, fontSize: 22, fontWeight: 500, lineHeight: 1.1, letterSpacing: '-0.01em' }}>{a.name}</div>
                  </div>
                  <div style={{ fontSize: 13, color: ONYX.textDim, marginTop: 6, fontStyle: 'italic' }}>{genres.join(' · ') || '—'}</div>
                  <div style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${ONYX.line}` }}>
                    {a.books.length} TITLE{a.books.length === 1 ? '' : 'S'} <span style={{ opacity: 0.5, margin: '0 6px' }}>·</span> {seriesTotalDur(a.books)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <BrowseList
          columns={[
            { id: 'name', label: 'Narrator', flex: 2 },
            { id: 'titles', label: 'Titles', width: 80 },
            { id: 'dur', label: 'Duration', width: 110 },
          ]}
          rows={list.map(a => ({
            key: a.name,
            onClick: () => open(a.name),
            leading: <Initial name={a.name} icon="headphones" small />,
            sort: {
              name: a.name,
              titles: a.books.length,
              dur: a.books.reduce((acc, b) => acc + parseDur(b.dur), 0),
            },
            cells: {
              name: <div style={{ fontFamily: ONYX.serif, fontSize: 14, fontWeight: 500 }}>{a.name}</div>,
              titles: <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.textMute }}>{a.books.length}</div>,
              dur: <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.textMute }}>{seriesTotalDur(a.books)}</div>,
            },
          }))}
        />
      )}
    </BrowseView>
  );
}

// --- Collections view -----------------------------------------------------
// Skald shows user-curated collections here — pre-seeded with a few examples.
function CollectionsView({ st, inline = false }) {
  const SEED_COLLECTIONS = [
    { name: 'Sword & Sorcery', subtitle: 'High fantasy with knightly leads', bookIds: ['cold-iron', 'fell-sword', 'burning-white', 'broken-eye', 'light-falls'] },
    { name: 'LitRPG Marathon', subtitle: 'Long-running progression epics', bookIds: ['doomsday', 'anarchist', 'feral', 'butcher', 'bedlam', 'inevitable', 'parade'] },
    { name: 'Sanderson Cosmere', subtitle: 'The whole interconnected universe', bookIds: ['emberdark'] },
    { name: 'Listening Comfort', subtitle: 'Re-listen anytime', bookIds: ['cold-iron', 'sam', 'black-prism'] },
  ];
  // User-created collections live in component state for the session.
  const [userCollections, setUserCollections] = React.useState([]);
  let allCollections = [...SEED_COLLECTIONS, ...userCollections];
  if (st.search) {
    const q = st.search.toLowerCase();
    allCollections = allCollections.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.subtitle || '').toLowerCase().includes(q) ||
      c.bookIds.some(id => {
        const b = LIBRARY.find(x => x.id === id);
        return b && (b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q));
      })
    );
  }

  const openCollection = (c) => {
    st.setContextFilter({ kind: 'collection', value: c.name, bookIds: c.bookIds });
    st.setShelfTab('library');
    st.setScreen('library');
  };

  const createCollection = () => {
    const name = window.prompt('Name your new collection:');
    if (!name || !name.trim()) return;
    const subtitle = window.prompt('A short description (optional):') || 'Empty — add books from the shelf.';
    setUserCollections(prev => [...prev, { name: name.trim(), subtitle, bookIds: [] }]);
  };

  return (
    <BrowseView st={st} title="Collections" subtitle={`${allCollections.length} ${allCollections.length === 1 ? 'collection' : 'collections'} · sets that don't follow a single series or author`} showModeToggle inline={inline}>
      {st.libraryView === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}>
          {allCollections.map(c => {
            const books = c.bookIds.map(id => LIBRARY.find(b => b.id === id)).filter(Boolean);
            return (
              <button key={c.name} onClick={() => openCollection(c)} className="onyx-poster" style={posterTile()}>
                {books.length > 0 ? (
                  <CoverMosaic books={books} />
                ) : (
                  <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ONYX.textMute, fontFamily: ONYX.serif, fontStyle: 'italic', fontSize: 14, background: 'linear-gradient(180deg, rgba(212,166,74,0.06), rgba(0,0,0,0.12))', borderBottom: `1px solid ${ONYX.line}` }}>Empty collection</div>
                )}
                <div style={{ padding: '18px 16px 16px', textAlign: 'center' }}>
                  <div style={{ fontFamily: ONYX.serif, fontSize: 22, fontWeight: 500, lineHeight: 1.1, color: ONYX.text, letterSpacing: '-0.01em' }}>{c.name}</div>
                  <div style={{ fontSize: 13, color: ONYX.textDim, marginTop: 6, fontStyle: 'italic' }}>{c.subtitle}</div>
                  <div style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${ONYX.line}` }}>
                    {books.length} TITLE{books.length === 1 ? '' : 'S'}
                  </div>
                </div>
              </button>
            );
          })}
          {/* Create new — matches the poster card dimensions for visual rhythm */}
          <button onClick={createCollection} title="Create a new collection" className="onyx-poster" style={{
            ...posterTile(),
            background: 'transparent',
            border: `1px dashed ${ONYX.glassEdge}`,
            color: ONYX.textMute,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10,
            minHeight: 380,
          }}>
            <Icon name="plus" size={22} />
            <div style={{ fontFamily: ONYX.serif, fontSize: 16, fontStyle: 'italic' }}>New collection</div>
          </button>
        </div>
      ) : (
        <BrowseList
          columns={[
            { id: 'name', label: 'Collection', flex: 2 },
            { id: 'subtitle', label: 'Description', flex: 2 },
            { id: 'titles', label: 'Titles', width: 80 },
          ]}
          rows={[
            ...allCollections.map(c => {
              const books = c.bookIds.map(id => LIBRARY.find(b => b.id === id)).filter(Boolean);
              return {
                key: c.name,
                onClick: () => openCollection(c),
                leading: books[0] ? <Cover book={books[0]} w={28} /> : <div style={{ width: 28, height: 28, borderRadius: 4, background: ONYX.glass, border: `1px dashed ${ONYX.glassEdge}` }} />,
                sort: { name: c.name, subtitle: c.subtitle || '', titles: books.length },
                cells: {
                  name: <div style={{ fontFamily: ONYX.serif, fontSize: 14, fontWeight: 500, color: ONYX.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>,
                  subtitle: <div style={{ fontSize: 12.5, color: ONYX.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subtitle}</div>,
                  titles: <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.textMute }}>{books.length}</div>,
                },
              };
            }),
            {
              key: '__new__',
              onClick: createCollection,
              leading: <div style={{ width: 28, height: 28, borderRadius: 14, border: `1px dashed ${ONYX.glassEdge}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ONYX.textMute }}><Icon name="plus" size={11} /></div>,
              sort: { name: '\uFFFF', subtitle: '', titles: -1 },
              cells: {
                name: <div style={{ fontFamily: ONYX.serif, fontSize: 14, fontStyle: 'italic', color: ONYX.textMute }}>New collection…</div>,
                subtitle: <div style={{ fontSize: 12.5, color: ONYX.textMute }}>Create an empty collection.</div>,
                titles: <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.textMute }}>—</div>,
              },
            },
          ]}
        />
      )}
    </BrowseView>
  );
}

// --- Home view ------------------------------------------------------------
function HomeView({ st }) {
  const inProg = LIBRARY.filter(b => b.progress > 0);
  const recent = LIBRARY.slice(0, 6);
  const focus = st.currentBook;

  return (
    <BrowseView st={st} title="Welcome back, Jordan" subtitle="Pick up where you left off, or start something new.">
      {/* Hero — current book in big format */}
      <div style={{
        display: 'flex', gap: 28, padding: 28,
        background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`, borderRadius: 16,
        marginBottom: 28, alignItems: 'center',
      }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ position: 'absolute', inset: -12, borderRadius: 16, background: `radial-gradient(50% 50% at 50% 50%, ${ONYX.accent}33, transparent 70%)`, filter: 'blur(40px)', zIndex: 0 }} />
          <div style={{ position: 'relative' }}>
            <Cover book={focus} w={170} />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: ONYX.mono, fontSize: 10, letterSpacing: '0.18em', color: ONYX.textMute, textTransform: 'uppercase' }}>Continue listening</div>
          <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.accent, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 12 }}>{focus.series}</div>
          <div style={{ fontFamily: ONYX.serif, fontSize: 38, fontWeight: 500, lineHeight: 1.05, letterSpacing: '-0.015em', marginTop: 4 }}>{focus.title}</div>
          <div style={{ fontSize: 13.5, color: ONYX.textDim, marginTop: 6 }}>by {focus.author} · narrated by {focus.narrator}</div>
          <div style={{ marginTop: 16, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden', maxWidth: 320 }}>
            <div style={{ width: '42%', height: '100%', background: ONYX.accent }} />
          </div>
          <div style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, letterSpacing: '0.06em', marginTop: 6 }}>42% · Ch. 14 of 18 · 14h 02m remaining</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button onClick={() => { st.setPlaying(true); st.setScreen('player'); }} style={{
              padding: '11px 22px', background: ONYX.accent, color: ONYX.bg, border: 'none',
              borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 14,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Icon name="play" size={13} /> Resume
            </button>
            <button onClick={() => st.setScreen('player')} style={{
              padding: '11px 18px', background: 'transparent', color: ONYX.text,
              border: `1px solid ${ONYX.glassEdge}`, borderRadius: 10, cursor: 'pointer',
              fontFamily: 'inherit', fontWeight: 500, fontSize: 13,
            }}>Open player</button>
          </div>
        </div>
      </div>

      {/* In progress row */}
      {inProg.length > 1 && (
        <Section title="Other books in progress">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            {inProg.filter(b => b.id !== focus.id).map(b => (
              <TileMini key={b.id} book={b} st={st} />
            ))}
          </div>
        </Section>
      )}

      {/* Recently added */}
      <Section title="Recently added">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {recent.map(b => (
            <button key={b.id} onClick={() => { st.setCurrentBookId(b.id); st.setScreen('player'); }} style={{
              background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
              fontFamily: 'inherit', textAlign: 'left', color: 'inherit', width: 120,
            }}>
              <Cover book={b} w={120} />
              <div style={{ marginTop: 7, fontSize: 12, fontWeight: 500, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</div>
              <div style={{ marginTop: 1, fontSize: 11, color: ONYX.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Stats">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          {[
            { l: 'Listened this week', v: '4h 38m' },
            { l: 'Current streak', v: '12 days' },
            { l: 'Books finished', v: '24' },
            { l: 'Bookmarks', v: '142' },
          ].map(s => (
            <div key={s.l} style={{ padding: 16, background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`, borderRadius: 12 }}>
              <div style={{ fontFamily: ONYX.mono, fontSize: 9.5, color: ONYX.textMute, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{s.l}</div>
              <div style={{ fontFamily: ONYX.serif, fontSize: 26, fontWeight: 500, marginTop: 6, color: ONYX.accent }}>{s.v}</div>
            </div>
          ))}
        </div>
      </Section>
    </BrowseView>
  );
}

// --- shared bits ----------------------------------------------------------
// inline=true → rendered inside the Library shelf pane (no TopNav, no big
// page title, smaller subtitle). Used by SeriesView/AuthorsView/etc. when
// they're acting as shelf tabs rather than standalone screens.
function BrowseView({ st, title, subtitle, showModeToggle = false, children, inline = false }) {
  if (inline) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {/* Shelf header — keeps the tab bar at the same row as the count + view-mode toggle. */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 4px 14px', gap: 16 }}>
          <div style={{ flexShrink: 0, minWidth: 0 }}>
            {subtitle && (
              <div style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{subtitle}</div>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
            <ShelfTabs st={st} />
          </div>
          <div style={{ flexShrink: 0 }}>
            {showModeToggle && <ViewModeToggle st={st} />}
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, paddingRight: 4 }}>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, padding: '8px 24px 24px', minWidth: 0, minHeight: 0 }}>
      <TopNav st={st} />
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, paddingRight: 4 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', padding: '12px 4px 20px', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: ONYX.serif, fontSize: 30, fontWeight: 500, letterSpacing: '-0.015em' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 13, color: ONYX.textDim, marginTop: 4 }}>{subtitle}</div>}
          </div>
          {showModeToggle && <ViewModeToggle st={st} />}
        </div>
        {children}
      </div>
    </div>
  );
}

// Two-button grid/list toggle.
function ViewModeToggle({ st }) {
  return (
    <div style={{
      display: 'flex', padding: 3, gap: 2,
      background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`, borderRadius: 8,
    }}>
      {[
        { id: 'grid', icon: 'grid', label: 'Grid' },
        { id: 'list', icon: 'list', label: 'List' },
      ].map(m => {
        const active = st.libraryView === m.id;
        return (
          <button key={m.id} onClick={() => st.setLibraryView(m.id)} title={`${m.label} view`} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
            background: active ? ONYX.accentDim : 'transparent',
            border: 'none',
            color: active ? ONYX.accent : ONYX.textDim,
            fontFamily: ONYX.mono, fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase',
            fontWeight: active ? 600 : 400,
          }}>
            <Icon name={m.icon} size={13} />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

// Generic responsive table — used by Series/Authors/Narrators in list mode.
// Headers are clickable to sort; click toggles asc → desc → asc.
// Each row supplies a `sort` map: { [columnId]: primitive } used for ordering.
function BrowseList({ columns, rows }) {
  const [sortBy, setSortBy] = React.useState({ col: columns[0]?.id, dir: 'asc' });
  const colSizes = columns.map(c => c.width ? `${c.width}px` : `${c.flex || 1}fr`).join(' ');
  const grid = `48px ${colSizes} 16px`;

  const onHeader = (id) => {
    if (sortBy.col === id) {
      setSortBy({ col: id, dir: sortBy.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setSortBy({ col: id, dir: 'asc' });
    }
  };

  const sorted = React.useMemo(() => {
    const out = rows.slice();
    out.sort((a, b) => {
      const av = a.sort?.[sortBy.col];
      const bv = b.sort?.[sortBy.col];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return sortBy.dir === 'asc' ? av - bv : bv - av;
      return sortBy.dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return out;
  }, [rows, sortBy.col, sortBy.dir]);

  return (
    <div style={{
      background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`,
      borderRadius: 12, overflow: 'hidden',
    }}>
      {/* header */}
      <div style={{
        display: 'grid', gridTemplateColumns: grid, alignItems: 'center', gap: 16,
        padding: '12px 16px', borderBottom: `1px solid ${ONYX.line}`,
        background: 'rgba(0,0,0,0.18)',
      }}>
        <div />
        {columns.map(c => {
          const active = sortBy.col === c.id;
          return (
            <button key={c.id} onClick={() => onHeader(c.id)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontFamily: ONYX.mono, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: active ? ONYX.accent : ONYX.textMute,
              textAlign: 'left',
            }}>
              {c.label}
              <SortIndicator active={active} dir={sortBy.dir} />
            </button>
          );
        })}
        <div />
      </div>
      {sorted.map((r, i) => (
        <button key={r.key} onClick={r.onClick} style={{
          display: 'grid', gridTemplateColumns: grid, alignItems: 'center', gap: 16,
          padding: '10px 16px', width: '100%', textAlign: 'left',
          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
          border: 'none', borderTop: i === 0 ? 'none' : `1px solid ${ONYX.line}`,
          cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
        }} className="onyx-row">
          {r.leading}
          {columns.map(c => <div key={c.id} style={{ minWidth: 0 }}>{r.cells[c.id]}</div>)}
          <Icon name="chevron-right" size={11} style={{ color: ONYX.textMute, opacity: 0.5 }} />
        </button>
      ))}
    </div>
  );
}

// Tiny up/down chevron indicator for column sort state.
function SortIndicator({ active, dir }) {
  return (
    <svg width="9" height="11" viewBox="0 0 9 11" style={{ flexShrink: 0, opacity: active ? 1 : 0.25 }}>
      <path d="M4.5 1 L1 5 L8 5 Z" fill={active && dir === 'asc' ? 'currentColor' : 'rgba(235,231,223,0.3)'} />
      <path d="M4.5 10 L1 6 L8 6 Z" fill={active && dir === 'desc' ? 'currentColor' : 'rgba(235,231,223,0.3)'} />
    </svg>
  );
}

function browseTile() {
  return {
    display: 'flex', gap: 14, padding: 14,
    background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`,
    borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
    textAlign: 'left', alignItems: 'center',
  };
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontFamily: ONYX.serif, fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em', marginBottom: 12, padding: '0 4px' }}>{title}</div>
      {children}
    </div>
  );
}

function StackedCovers({ books, large = false }) {
  const w = large ? 56 : 42;
  return (
    <div style={{ position: 'relative', width: w + (books.length - 1) * 14, height: w, flexShrink: 0 }}>
      {books.map((b, i) => (
        <div key={b.id} style={{ position: 'absolute', left: i * 14, top: 0, zIndex: books.length - i, transform: `rotate(${(i - 1) * 2}deg)`, transformOrigin: 'bottom left' }}>
          <Cover book={b} w={w} />
        </div>
      ))}
    </div>
  );
}

// CoverFan — 3-5 covers fanned out behind the lead cover, used for Series tiles.
function CoverFan({ books }) {
  const lead = books[0];
  const back = books.slice(1, 5); // up to 4 in back
  const leadW = 200;
  const backW = 150;
  return (
    <div style={{
      position: 'relative', height: 280, padding: '32px 16px 0',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      background: 'linear-gradient(180deg, rgba(212,166,74,0.06), rgba(0,0,0,0.12))',
      borderBottom: `1px solid ${ONYX.line}`, overflow: 'hidden',
    }}>
      {/* Glow behind lead cover */}
      <div style={{ position: 'absolute', left: '50%', top: '45%', transform: 'translate(-50%, -50%)', width: 260, height: 260, borderRadius: '50%', background: `radial-gradient(50% 50% at 50% 50%, ${ONYX.accent}33, transparent 70%)`, filter: 'blur(40px)', pointerEvents: 'none' }} />
      {/* Back covers — fanned symmetrically */}
      {back.map((b, i) => {
        const slot = i % 2 === 0 ? (i / 2) + 1 : -((i + 1) / 2);
        const rot = slot * 7;
        const tx = slot * 38;
        const ty = Math.abs(slot) * 8;
        const zScale = 1 - Math.abs(slot) * 0.04;
        return (
          <div key={b.id} style={{
            position: 'absolute', bottom: 0,
            transform: `translateX(${tx}px) translateY(${ty}px) rotate(${rot}deg) scale(${zScale})`,
            transformOrigin: 'bottom center',
            opacity: 1 - Math.abs(slot) * 0.15,
            filter: 'brightness(0.7) saturate(0.85)',
          }}>
            <Cover book={b} w={backW} />
          </div>
        );
      })}
      {/* Lead cover */}
      <div style={{ position: 'relative', zIndex: 5, filter: 'drop-shadow(0 16px 36px rgba(0,0,0,0.55))' }}>
        <Cover book={lead} w={leadW} />
      </div>
    </div>
  );
}

// CoverMosaic — up to 4 covers in a 2x2 quilt, used for Authors / Narrators tiles.
function CoverMosaic({ books }) {
  const slots = books.slice(0, 4);
  return (
    <div style={{
      position: 'relative', height: 280,
      background: 'linear-gradient(180deg, rgba(212,166,74,0.06), rgba(0,0,0,0.12))',
      borderBottom: `1px solid ${ONYX.line}`, overflow: 'hidden',
      display: 'grid',
      gridTemplateColumns: slots.length === 1 ? '1fr' : '1fr 1fr',
      gridTemplateRows: slots.length <= 2 ? '1fr' : '1fr 1fr',
      gap: 1,
    }}>
      <div style={{ position: 'absolute', inset: '20% 30% 0', borderRadius: '50%', background: `radial-gradient(50% 50% at 50% 50%, ${ONYX.accent}26, transparent 70%)`, filter: 'blur(40px)', pointerEvents: 'none', zIndex: 0 }} />
      {slots.map((b, i) => (
        <div key={b.id} style={{ position: 'relative', overflow: 'hidden', zIndex: 1 }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <CoverFill book={b} />
          </div>
        </div>
      ))}
    </div>
  );
}

// CoverFill — renders a Cover sized to fill its parent (cropped, no aspect-ratio breaks).
function CoverFill({ book }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div style={{ transform: 'scale(3.2)', transformOrigin: 'center' }}>
        <Cover book={book} w={100} />
      </div>
    </div>
  );
}

function posterTile() {
  return {
    display: 'flex', flexDirection: 'column', padding: 0,
    background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`,
    borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
    textAlign: 'left', overflow: 'hidden',
    transition: 'transform 0.15s, border-color 0.15s, box-shadow 0.15s',
  };
}

function Initial({ name, icon = null, small = false }) {
  const i = (name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const size = small ? 32 : 48;
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 2, flexShrink: 0,
      background: 'linear-gradient(135deg, rgba(212,166,74,0.25), rgba(212,166,74,0.08))',
      border: `1px solid ${ONYX.glassEdge}`,
      color: ONYX.accent, fontFamily: ONYX.serif, fontSize: small ? 13 : 18, fontWeight: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {icon ? <Icon name={icon} size={small ? 14 : 18} /> : i}
    </div>
  );
}

function TileMini({ book, st }) {
  return (
    <button onClick={() => { st.setCurrentBookId(book.id); st.setScreen('player'); }} style={{
      display: 'flex', gap: 12, padding: 12,
      background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`, borderRadius: 10,
      cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', textAlign: 'left',
    }}>
      <Cover book={book} w={56} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.title}</div>
        <div style={{ fontSize: 11, color: ONYX.textMute, marginTop: 2 }}>{book.author}</div>
        <div style={{ flex: 1 }} />
        <div style={{ height: 2, background: 'rgba(255,255,255,0.1)', borderRadius: 1, overflow: 'hidden' }}>
          <div style={{ width: `${book.progress * 100}%`, height: '100%', background: ONYX.accent }} />
        </div>
      </div>
    </button>
  );
}

function seriesTotalDur(books) {
  let total = 0;
  for (const b of books) total += parseDur(b.dur);
  const h = Math.floor(total / 3600);
  return `${h}H`;
}

Object.assign(window, { SeriesView, AuthorsView, NarratorsView, CollectionsView, HomeView });
