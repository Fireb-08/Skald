import Cover from '../Cover';
import type { LibraryItem, OnyxState } from '../../state/onyx';
import { bookTitle, bookAuthor, bookProgress } from '../../state/onyx';

export interface TileMiniProps {
  book: LibraryItem;
  st: OnyxState;
}

export default function TileMini({ book, st }: TileMiniProps) {
  const prog = bookProgress(book, st.mediaProgress);
  return (
    <button
      onClick={() => { st.setCurrentBookId(book.id); st.setScreen('player'); }}
      style={{
        display: 'flex', gap: 12, padding: 12,
        background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 10,
        cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', textAlign: 'left',
      }}
    >
      <Cover item={book} size={56} serverUrl={st.serverUrl} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bookTitle(book)}</div>
        <div style={{ fontSize: 11, color: 'var(--onyx-text-mute)', marginTop: 2 }}>{bookAuthor(book)}</div>
        <div style={{ flex: 1 }} />
        <div style={{ height: 2, background: 'rgba(255,255,255,0.1)', borderRadius: 1, overflow: 'hidden' }}>
          <div style={{ width: `${prog * 100}%`, height: '100%', background: 'var(--onyx-accent)' }} />
        </div>
      </div>
    </button>
  );
}
