import Cover from '../Cover';
import type { LibraryItem } from '../../state/onyx';

export interface StackedCoversProps {
  books: LibraryItem[];
  large?: boolean;
  serverUrl?: string;
}

export default function StackedCovers({ books, large = false, serverUrl }: StackedCoversProps) {
  const w = large ? 56 : 42;
  return (
    <div style={{ position: 'relative', width: w + (books.length - 1) * 14, height: w, flexShrink: 0 }}>
      {books.map((b, i) => (
        <div key={b.id} style={{ position: 'absolute', left: i * 14, top: 0, zIndex: books.length - i, transform: `rotate(${(i - 1) * 2}deg)`, transformOrigin: 'bottom left' }}>
          <Cover item={b} size={w} serverUrl={serverUrl} />
        </div>
      ))}
    </div>
  );
}
