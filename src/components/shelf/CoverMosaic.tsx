import CoverFill from './CoverFill';
import type { LibraryItem } from '../../state/onyx';

export interface CoverMosaicProps {
  books: LibraryItem[];
}

export default function CoverMosaic({ books }: CoverMosaicProps) {
  const slots = books.slice(0, 4);
  return (
    <div style={{
      position: 'relative', height: 280,
      background: 'linear-gradient(180deg, rgba(212,166,74,0.06), rgba(0,0,0,0.12))',
      borderBottom: '1px solid var(--onyx-line)', overflow: 'hidden',
      display: 'grid',
      gridTemplateColumns: slots.length === 1 ? '1fr' : '1fr 1fr',
      gridTemplateRows: slots.length <= 2 ? '1fr' : '1fr 1fr',
      gap: 1,
    }}>
      <div style={{ position: 'absolute', inset: '20% 30% 0', borderRadius: '50%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.15), transparent 70%)', filter: 'blur(40px)', pointerEvents: 'none', zIndex: 0 }} />
      {slots.map(b => (
        <div key={b.id} style={{ position: 'relative', overflow: 'hidden', zIndex: 1 }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <CoverFill book={b} />
          </div>
        </div>
      ))}
    </div>
  );
}
