import Cover from '../Cover';
import type { LibraryItem } from '../../state/onyx';

export interface CoverFillProps {
  book: LibraryItem;
  serverUrl?: string;
}

export default function CoverFill({ book, serverUrl }: CoverFillProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div style={{ transform: 'scale(3.2)', transformOrigin: 'center' }}>
        <Cover item={book} size={100} serverUrl={serverUrl} />
      </div>
    </div>
  );
}
