import type { OnyxState } from '../../state/onyx';
import { bookTitle } from '../../state/onyx';
import { playAudio, pauseAudio } from '../../api/abs';
import Cover from '../Cover';
import Icon from '../Icon';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface MiniPlayerProps { st: OnyxState; }

export default function MiniPlayer({ st }: MiniPlayerProps) {
  const playing = st.playing;
  const currentBook = st.currentBook;
  if (!currentBook || !st.currentBookId) return null;
  if (!st.focusedBookId || st.focusedBookId === st.currentBookId) return null;

  const progress = st.bookSecs > 0 ? st.position / st.bookSecs : 0;

  return (
    <div style={{
      position: 'absolute',
      bottom: 16,
      left: 16,
      zIndex: 100,
      width: 280,
      background: 'var(--onyx-glass-strong)',
      backdropFilter: 'blur(40px) saturate(120%)',
      WebkitBackdropFilter: 'blur(40px) saturate(120%)',
      border: '1px solid var(--onyx-glass-edge)',
      borderRadius: 10,
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
        {/* Cover — click to return focus to now-playing */}
        <button
          onClick={() => st.setFocusedBookId(st.currentBookId)}
          title="Return to now playing"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
        >
          <Cover item={currentBook} size={40} serverUrl={st.serverUrl} style={{ borderRadius: 4 }} />
        </button>

        {/* Info column */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            Now Playing
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {bookTitle(currentBook)}
          </div>
          {/* Progress track */}
          <div style={{ width: '100%', height: 4, background: 'var(--onyx-glass-edge)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(1, progress) * 100}%`, height: '100%', background: 'var(--onyx-accent)', borderRadius: 2 }} />
          </div>
        </div>

        {/* Play / Pause */}
        <button
          onClick={() => (playing ? pauseAudio() : playAudio()).catch(console.error)}
          style={{
            width: 32, height: 32, borderRadius: 16, flexShrink: 0,
            background: 'var(--onyx-accent)', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--onyx-bg)',
          }}
          title={playing ? 'Pause' : 'Play'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={14} />
        </button>
      </div>
    </div>
  );
}
