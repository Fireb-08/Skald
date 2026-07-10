// Step 2 — Choose your path. Three large selectable cards set the branch:
// Audiobookshelf (server), Local libraries (this PC), or Both. Selecting a card
// records the choice and advances. (First-Launch Onboarding, Phase 2.)
import { useState } from 'react';
import { MONO, SERIF } from './frame';

export type OnboardingPath = 'abs' | 'local' | 'both';

export interface ChoosePathStepProps {
  value: OnboardingPath | null;
  onChoose: (p: OnboardingPath) => void;
}

// Inline card glyphs — no matching entries exist in Icon.tsx for "server"/"folder",
// so small purpose-drawn marks keep the metaphor precise.
function Glyph({ kind }: { kind: OnboardingPath }) {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'abs') {
    // Stacked server racks.
    return (
      <svg width={26} height={26} viewBox="0 0 24 24">
        <rect x={4} y={4} width={16} height={6} rx={1.5} {...stroke} />
        <rect x={4} y={14} width={16} height={6} rx={1.5} {...stroke} />
        <circle cx={7.5} cy={7} r={0.9} fill="currentColor" stroke="none" />
        <circle cx={7.5} cy={17} r={0.9} fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === 'local') {
    // Folder.
    return (
      <svg width={26} height={26} viewBox="0 0 24 24">
        <path d="M3 6.5 a1.5 1.5 0 0 1 1.5 -1.5 h4 l2 2 h8 a1.5 1.5 0 0 1 1.5 1.5 v9 a1.5 1.5 0 0 1 -1.5 1.5 h-14 a1.5 1.5 0 0 1 -1.5 -1.5 Z" {...stroke} />
      </svg>
    );
  }
  // Both — server + folder overlaid.
  return (
    <svg width={26} height={26} viewBox="0 0 24 24">
      <rect x={3} y={4} width={13} height={5} rx={1.3} {...stroke} />
      <path d="M8 12.5 a1.3 1.3 0 0 1 1.3 -1.3 h3 l1.6 1.6 h6 a1.3 1.3 0 0 1 1.3 1.3 v6 a1.3 1.3 0 0 1 -1.3 1.3 h-10.6 a1.3 1.3 0 0 1 -1.3 -1.3 Z" {...stroke} />
    </svg>
  );
}

const CARDS: { id: OnboardingPath; title: string; blurb: string }[] = [
  { id: 'abs',   title: 'Audiobookshelf',  blurb: 'Connect to your ABS server to stream, sync progress, and download for offline listening.' },
  { id: 'local', title: 'Local libraries', blurb: 'Build libraries from audiobooks already on this PC. No server, no account — Skald reads the files directly.' },
  { id: 'both',  title: 'Both',            blurb: 'A server for the main collection, plus local libraries for anything else. Skald keeps them side by side in one library switcher.' },
];

export default function ChoosePathStep({ value, onChoose }: ChoosePathStepProps) {
  const [hover, setHover] = useState<OnboardingPath | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {CARDS.map(card => {
        const selected = value === card.id;
        const lifted = hover === card.id || selected;
        return (
          <button
            key={card.id}
            type="button"
            onMouseEnter={() => setHover(card.id)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onChoose(card.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 18, textAlign: 'left', width: '100%',
              padding: '18px 20px', borderRadius: 14, cursor: 'pointer',
              background: selected
                ? 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.10)'
                : 'rgba(255,255,255,0.02)',
              border: `1px solid ${lifted ? 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.45)' : 'rgba(255,255,255,0.08)'}`,
              boxShadow: lifted ? '0 10px 30px rgba(0,0,0,0.35), 0 0 0 1px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.10)' : 'none',
              transform: lifted ? 'translateY(-1px)' : 'none',
              transition: 'transform 0.14s, box-shadow 0.18s, border-color 0.18s, background 0.18s',
              color: '#ebe7df',
            }}
          >
            <div style={{
              flexShrink: 0, width: 48, height: 48, borderRadius: 11,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.10)',
              border: '1px solid rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.22)',
              color: 'var(--onyx-accent)',
            }}>
              <Glyph kind={card.id} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: '#ebe7df' }}>{card.title}</div>
              <div style={{ fontSize: 12.5, color: 'rgba(235,231,223,0.6)', marginTop: 3, lineHeight: 1.45 }}>{card.blurb}</div>
            </div>
            {/* Selected check / hover chevron */}
            <div style={{ flexShrink: 0, fontFamily: MONO, fontSize: 16, color: selected ? 'var(--onyx-accent)' : 'rgba(235,231,223,0.3)' }}>
              {selected ? '✓' : '→'}
            </div>
          </button>
        );
      })}
    </div>
  );
}
