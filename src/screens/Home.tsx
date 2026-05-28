import type { OnyxState } from '../state/onyx';
import {
  chapterAt, fmtRemaining,
  bookTitle, bookAuthor, bookSeries, bookNarrator, bookProgress, bookCurrentTime,
} from '../state/onyx';
import Cover from '../components/Cover';
import Icon from '../components/Icon';
import Section from '../components/shelf/Section';
import TileMini from '../components/shelf/TileMini';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface HomeProps {
  st: OnyxState;
}

export default function Home({ st }: HomeProps) {
  const focus = st.currentBook;
  if (!focus) return null;

  const inProg = st.library.filter(b => bookProgress(b, st.mediaProgress) > 0);
  const recent = st.library.slice(0, 6);

  const focusProgress = st.position / (st.bookSecs || 1);
  const remaining     = st.bookSecs - st.position;
  const chapters = st.currentBookChapters;
  const { idx: chIdx } = chapterAt(chapters, st.position);

  const openBook = (id: string) => {
    st.setCurrentBookId(id);
    if (id !== st.currentBookId) {
      const b = st.library.find(x => x.id === id);
      if (b) st.setPosition(bookCurrentTime(b, st.mediaProgress));
    }
    st.setScreen('player');
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px', minHeight: 0 }}>

      <div style={{ padding: '12px 4px 20px' }}>
        <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 500, letterSpacing: '-0.015em' }}>Welcome back, Jordan</div>
        <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)', marginTop: 4 }}>Pick up where you left off, or start something new.</div>
      </div>

      <div style={{
        display: 'flex', gap: 28, padding: 28,
        background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 16,
        marginBottom: 28, alignItems: 'center',
      }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ position: 'absolute', inset: -12, borderRadius: 16, background: 'radial-gradient(50% 50% at 50% 50%, rgba(212,166,74,0.2), transparent 70%)', filter: 'blur(40px)', zIndex: 0 }} />
          <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => openBook(focus.id)}>
            <Cover item={focus} size={170} serverUrl={st.serverUrl} />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.18em', color: 'var(--onyx-text-mute)', textTransform: 'uppercase' }}>Continue listening</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-accent)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 12 }}>{bookSeries(focus)}</div>
          <div style={{ fontFamily: SERIF, fontSize: 38, fontWeight: 500, lineHeight: 1.05, letterSpacing: '-0.015em', marginTop: 4 }}>{bookTitle(focus)}</div>
          <div style={{ fontSize: 13.5, color: 'var(--onyx-text-dim)', marginTop: 6 }}>by {bookAuthor(focus)} · narrated by {bookNarrator(focus)}</div>
          <div style={{ marginTop: 16, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden', maxWidth: 320 }}>
            <div style={{ width: `${focusProgress * 100}%`, height: '100%', background: 'var(--onyx-accent)' }} />
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', marginTop: 6 }}>
            {Math.round(focusProgress * 100)}% · Ch. {chIdx + 1} of {chapters.length} · {fmtRemaining(remaining)} remaining
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button
              onClick={() => { st.setPlaying(true); st.setScreen('player'); }}
              style={{ padding: '11px 22px', background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <Icon name="play" size={13} /> Resume
            </button>
            <button
              onClick={() => st.setScreen('player')}
              style={{ padding: '11px 18px', background: 'transparent', color: 'var(--onyx-text)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, fontSize: 13 }}
            >
              Open player
            </button>
          </div>
        </div>
      </div>

      {inProg.length > 1 && (
        <Section title="Other books in progress">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            {inProg.filter(b => b.id !== focus.id).map(b => (
              <TileMini key={b.id} book={b} st={st} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Recently added">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {recent.map(b => (
            <button key={b.id} onClick={() => openBook(b.id)} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: 'inherit', width: 120 }}>
              <Cover item={b} size={120} serverUrl={st.serverUrl} />
              <div style={{ marginTop: 7, fontSize: 12, fontWeight: 500, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bookTitle(b)}</div>
              <div style={{ marginTop: 1, fontSize: 11, color: 'var(--onyx-text-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bookAuthor(b)}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Stats">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          {([
            { l: 'Total listened', v: st.listeningStats ? fmtRemaining(st.listeningStats.totalTime) : '—' },
            { l: 'Today',          v: st.listeningStats ? fmtRemaining(st.listeningStats.today)     : '—' },
            { l: 'Books',          v: st.listeningStats ? String(Object.keys(st.listeningStats.items).length) : '—' },
            { l: 'Days listened',  v: st.listeningStats ? String(Object.keys(st.listeningStats.days).length)  : '—' },
          ] as { l: string; v: string }[]).map(s => (
            <div key={s.l} style={{ padding: 16, background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 12 }}>
              <div style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{s.l}</div>
              <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 500, marginTop: 6, color: 'var(--onyx-accent)' }}>{s.v}</div>
            </div>
          ))}
        </div>
      </Section>

    </div>
  );
}
