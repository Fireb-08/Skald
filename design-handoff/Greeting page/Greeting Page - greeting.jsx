// Onyx — Greeting pane. Shown in the left "In focus" slot on first launch,
// before anything is playing. Same Glass card footprint (width 360, padding 28)
// as the focus card, so it slots in without disturbing the Library layout.
//
// Composition, top→bottom:
//   · live date eyebrow (mono)
//   · time-aware serif greeting with the user's name
//   · a User stats / Library stats toggle
//   · the selected stats page (numbers + gold bars + a 7-day sparkline)
//   · footer stat strip — In library / In progress / Finished (always present)

// --- Stats the Audiobookshelf server provides (sample figures) ---
const USER_STATS = {
  finished: 3,
  daysListened: 30,
  minutesTotal: 5210,
  weekMinutes: 255,
  dailyAvg: 36,
  bestDay: 184,
  streak: 1,
  last7: [ // last 7 days, oldest → newest
    { d: 'Wed', m: 0 }, { d: 'Thu', m: 60 }, { d: 'Fri', m: 0 }, { d: 'Sat', m: 0 },
    { d: 'Sun', m: 184 }, { d: 'Mon', m: 0 }, { d: 'Tue', m: 10 },
  ],
  recent: [
    { title: 'Empire of the Vampire', when: 'about 3 hours ago', len: '9 min' },
    { title: 'Empire of the Vampire', when: '2 days ago', len: '3 hr 3 min' },
    { title: 'Empire of the Vampire', when: '6 days ago', len: '61 min' },
  ],
};

const LIBRARY_STATS = {
  hours: '3,285',
  authors: 43,
  tracks: 708,
  sizeGb: '146.2',
  topGenres: [
    { label: 'Science Fiction & Fantasy', pct: 73 },
    { label: 'Literature & Fiction', pct: 20 },
    { label: 'Fantasy', pct: 17 },
    { label: 'Teen & Young Adult', pct: 4 },
  ],
  topAuthors: [
    { label: 'Brandon Sanderson', value: 57 },
    { label: 'Andrzej Sapkowski', value: 9 },
    { label: 'Miles Cameron', value: 9 },
    { label: 'Andrew Rowe', value: 8 },
    { label: 'Matt Dinniman', value: 8 },
  ],
};

function GreetingPane({ st, name = 'Jordan' }) {
  const [page, setPage] = React.useState('user'); // 'user' | 'library'

  const now = new Date();
  const hr = now.getHours();
  const partOfDay = hr < 5 ? 'night' : hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : hr < 21 ? 'evening' : 'night';
  const greeting = { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Still up' }[partOfDay];
  const dateLine = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();

  const inProg = LIBRARY.filter(b => b.progress > 0 && b.progress < 0.98).length;
  const finished = LIBRARY.filter(b => b.progress >= 0.98).length;

  return (
    <Glass style={{ width: 360, padding: 28, display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
      {/* faint gold hairline along the top edge, echoing the player chrome */}
      <div style={{ position: 'absolute', top: 0, left: 22, right: 22, height: 1, background: `linear-gradient(90deg, transparent, ${ONYX.accentEdge}, transparent)` }} />

      <div style={{ fontFamily: ONYX.mono, fontSize: 10, letterSpacing: '0.18em', color: ONYX.textMute, textTransform: 'uppercase' }}>{dateLine}</div>

      <div style={{ marginTop: 12, fontFamily: ONYX.serif, fontSize: 30, fontWeight: 500, lineHeight: 1.08, letterSpacing: '-0.015em', color: ONYX.text }}>
        {greeting},<br />{name}<span style={{ color: ONYX.accent }}>.</span>
      </div>

      {/* Toggle */}
      <div style={{ marginTop: 18, display: 'flex', padding: 3, gap: 3, background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`, borderRadius: 10 }}>
        {[{ id: 'user', label: 'Your stats' }, { id: 'library', label: 'Library stats' }].map(t => {
          const active = page === t.id;
          return (
            <button key={t.id} onClick={() => setPage(t.id)} style={{
              flex: 1, padding: '8px 0', borderRadius: 7, cursor: 'pointer', border: 'none',
              fontFamily: 'inherit', fontSize: 12, fontWeight: active ? 600 : 500,
              letterSpacing: '0.01em',
              background: active ? ONYX.accentDim : 'transparent',
              boxShadow: active ? `inset 0 0 0 1px ${ONYX.accentEdge}` : 'none',
              color: active ? ONYX.accent : ONYX.textDim,
              transition: 'background 0.15s, color 0.15s',
            }}>{t.label}</button>
          );
        })}
      </div>

      {/* Stats body — swaps with the toggle */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', marginTop: 18, marginRight: -6, paddingRight: 6 }}>
        {page === 'user' ? <UserStats /> : <LibraryStats />}
      </div>

      {/* Footer stat strip — always present */}
      <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px solid ${ONYX.line}`, display: 'flex', gap: 28 }}>
        <GreetStat label="In library" value={LIBRARY.length} />
        <GreetStat label="In progress" value={inProg} />
        <GreetStat label="Finished" value={finished} />
      </div>
    </Glass>
  );
}

// --- USER STATS PAGE ---
function UserStats() {
  const s = USER_STATS;
  return (
    <div className="greet-page" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Hero trio */}
      <div style={{ display: 'flex', gap: 24 }}>
        <BigStat value={s.minutesTotal.toLocaleString()} label="Minutes" />
        <BigStat value={s.daysListened} label="Days listened" />
        <BigStat value={s.finished} label="Finished" />
      </div>

      {/* 7-day listening sparkbars */}
      <div>
        <SubHead>Minutes listening · last 7 days</SubHead>
        <SparkBars data={s.last7} />
        <div style={{ display: 'flex', gap: 0, marginTop: 14 }}>
          <MiniStat value={s.weekMinutes} unit="min" label="This week" />
          <MiniStat value={s.dailyAvg} unit="min" label="Daily avg" />
          <MiniStat value={s.bestDay} unit="min" label="Best day" />
          <MiniStat value={s.streak} unit={s.streak === 1 ? 'day' : 'days'} label="Streak" />
        </div>
      </div>

      {/* Recent sessions */}
      <div>
        <SubHead>Recent sessions</SubHead>
        <div style={{ marginTop: 6 }}>
          {s.recent.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', borderTop: i === 0 ? 'none' : `1px solid ${ONYX.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: ONYX.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                <div style={{ fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 1 }}>{r.when}</div>
              </div>
              <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.accent, flexShrink: 0 }}>{r.len}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- LIBRARY STATS PAGE ---
function LibraryStats() {
  const s = LIBRARY_STATS;
  const maxAuthor = Math.max(...s.topAuthors.map(a => a.value));
  return (
    <div className="greet-page" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Hero quad */}
      <div style={{ display: 'flex', gap: 12 }}>
        <BigStat value={s.hours} label="Hours" w={74} />
        <BigStat value={s.authors} label="Authors" w={56} />
        <BigStat value={s.tracks} label="Tracks" w={56} />
        <BigStat value={s.sizeGb} label="GB" w={58} />
      </div>

      {/* Top genres */}
      <div>
        <SubHead>Top genres</SubHead>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 11 }}>
          {s.topGenres.map((g, i) => (
            <RankBar key={i} label={g.label} display={`${g.pct}%`} pct={g.pct} />
          ))}
        </div>
      </div>

      {/* Top authors */}
      <div>
        <SubHead>Top authors</SubHead>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 11 }}>
          {s.topAuthors.map((a, i) => (
            <RankBar key={i} rank={i + 1} label={a.label} display={a.value} pct={(a.value / maxAuthor) * 100} />
          ))}
        </div>
      </div>
    </div>
  );
}

// --- small shared pieces ---
function SubHead({ children }) {
  return <div style={{ fontFamily: ONYX.mono, fontSize: 9.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: ONYX.textMute }}>{children}</div>;
}

function BigStat({ value, label, w }) {
  return (
    <div style={{ width: w, flexShrink: 0 }}>
      <div style={{ fontFamily: ONYX.serif, fontSize: 26, fontWeight: 500, lineHeight: 1, color: ONYX.text }}>{value}</div>
      <div style={{ marginTop: 4, fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

function MiniStat({ value, unit, label }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{ fontFamily: ONYX.serif, fontSize: 18, fontWeight: 500, color: ONYX.text }}>{value}</span>
        <span style={{ fontFamily: ONYX.mono, fontSize: 8.5, color: ONYX.textMute }}>{unit}</span>
      </div>
      <div style={{ fontFamily: ONYX.mono, fontSize: 8.5, color: ONYX.textMute, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function SparkBars({ data }) {
  const max = Math.max(...data.map(d => d.m), 1);
  return (
    <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-end', gap: 8, height: 96 }}>
      {data.map((d, i) => {
        const h = d.m === 0 ? 2 : Math.max(4, Math.round((d.m / max) * 88));
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ fontFamily: ONYX.mono, fontSize: 8.5, color: d.m === max ? ONYX.accent : ONYX.textMute, height: 12 }}>{d.m > 0 ? d.m : ''}</div>
            <div style={{
              width: '100%', height: h, borderRadius: 3,
              background: d.m === 0 ? 'rgba(255,255,255,0.08)' : `linear-gradient(180deg, ${ONYX.accentBright}, ${ONYX.accent})`,
              boxShadow: d.m === max ? `0 0 12px ${ONYX.accentEdge}` : 'none',
            }} />
            <div style={{ fontFamily: ONYX.mono, fontSize: 8.5, color: ONYX.textMute, letterSpacing: '0.04em' }}>{d.d}</div>
          </div>
        );
      })}
    </div>
  );
}

function RankBar({ rank, label, display, pct }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
        {rank != null && <span style={{ fontFamily: ONYX.mono, fontSize: 9.5, color: ONYX.textMute, width: 14, flexShrink: 0 }}>{rank}</span>}
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: ONYX.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.accent, flexShrink: 0 }}>{display}</span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden', marginLeft: rank != null ? 22 : 0 }}>
        <div style={{ width: `${Math.max(4, pct)}%`, height: '100%', background: `linear-gradient(90deg, ${ONYX.accentDeep}, ${ONYX.accent})`, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function GreetStat({ label, value }) {
  return (
    <div>
      <div style={{ fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 3, fontFamily: ONYX.serif, fontSize: 22, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

Object.assign(window, { GreetingPane });
