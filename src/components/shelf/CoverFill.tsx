import Cover from '../Cover';
import type { LibraryItem } from '../../state/onyx';

export interface CoverFillProps {
  book: LibraryItem;
}

export default function CoverFill({ book }: CoverFillProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div style={{ transform: 'scale(3.2)', transformOrigin: 'center' }}>
        <Cover item={book} size={100} />
      </div>
    </div>
  );
}
