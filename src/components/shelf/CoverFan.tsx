import Cover from '../Cover';
import type { LibraryItem } from '../../state/onyx';

export interface CoverFanProps {
  books: LibraryItem[];
  serverUrl?: string;
}

export default function CoverFan({ books, serverUrl }: CoverFanProps) {
  const lead = books[0];
  const back = books.slice(1, 5);
  const leadW = 200;
  const backW = 150;
  return (
    <div style={{
      position: 'relative', height: 280, padding: '32px 16px 0',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      background: 'linear-gradient(180deg, rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.06), rgba(0,0,0,0.12))',
      borderBottom: '1px solid var(--onyx-line)', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', left: '50%', top: '45%', transform: 'translate(-50%, -50%)',
        width: 260, height: 260, borderRadius: '50%',
        background: 'radial-gradient(50% 50% at 50% 50%, rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.2), transparent 70%)',
        filter: 'blur(40px)', pointerEvents: 'none',
      }} />
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
            <Cover item={b} size={backW} serverUrl={serverUrl} />
          </div>
        );
      })}
      <div style={{ position: 'relative', zIndex: 5, filter: 'drop-shadow(0 16px 36px rgba(0,0,0,0.55))' }}>
        <Cover item={lead} size={leadW} serverUrl={serverUrl} />
      </div>
    </div>
  );
}
