// Step 5 — How to add books. Teaches the two import routes once, at the moment it
// matters: the shared Add books dialog exposes files, folders, and the watched
// Staging folder from the same entry point used by the main shell and Settings.
// (First-Launch Onboarding, Phase 3.)
import { useState } from 'react';
import type { OnyxState } from '../../state/onyx';
import type { Library } from '../../api/abs';
import { GoldButton, SERIF, MONO, SANS } from './frame';
import LocalImportDialog from '../LocalImportDialog';

export interface AddBooksStepProps {
  st: OnyxState;
  // The library created in step 4 (null if the user skipped it). Determines
  // whether the inline "Add books now" action is available.
  library: Library | null;
  onContinue: () => void;
}

// A self-contained CSS scene: a file glyph drops into Staging, then travels to the
// filed Author/Series/Title shelf — looping. All motion is in index.css keyframes
// (onb-file / onb-pulse), gated by prefers-reduced-motion.
function StagingScene() {
  const box: React.CSSProperties = {
    position: 'absolute', top: '30%', width: 96, height: 62, borderRadius: 10,
    border: '1px solid rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.3)',
    background: 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.05)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
  };
  const cap: React.CSSProperties = { fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(235,231,223,0.5)' };
  return (
    <div className="onb-scene" style={{ position: 'relative', height: 130, marginTop: 6, marginBottom: 4 }}>
      {/* Dotted travel line */}
      <div style={{ position: 'absolute', top: '50%', left: '20%', right: '20%', height: 0, borderTop: '1px dashed rgba(235,231,223,0.15)' }} />
      {/* Staging box (left) */}
      <div style={{ ...box, left: '8%' }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>📁</span>
        <span style={cap}>Staging</span>
      </div>
      {/* Filed box (right) */}
      <div className="onb-filed" style={{ ...box, right: '8%' }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>🗂️</span>
        <span style={cap}>Author / Series</span>
      </div>
      {/* Travelling file glyph */}
      <div className="onb-file" style={{ position: 'absolute', width: 24, height: 28, borderRadius: 4, background: 'linear-gradient(180deg,#e9bb5e,#a37d2e)', boxShadow: '0 6px 16px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a1306', fontFamily: MONO, fontSize: 9, fontWeight: 700 }}>
        ♪
      </div>
    </div>
  );
}

function RouteCard({ badge, title, children }: { badge: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 200, padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
        <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--onyx-accent)', border: '1px solid rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.3)', borderRadius: 4, padding: '2px 6px' }}>{badge}</span>
        <span style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 600, color: '#ebe7df' }}>{title}</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'rgba(235,231,223,0.6)', lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

export default function AddBooksStep({ st, library, onContinue }: AddBooksStepProps) {
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <StagingScene />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <RouteCard badge="Automatic" title="Drop into Staging">
          Copy audiobooks — files <em>or whole book folders</em> — into the library's{' '}
          <span style={{ color: 'rgba(235,231,223,0.85)' }}>Staging</span> folder. Skald reads each book's tags and
          chapters and files it under Author / Series / Title automatically.
        </RouteCard>
        <RouteCard badge="Manual" title="Add books button">
          Use <span style={{ color: 'rgba(235,231,223,0.85)' }}>Add books</span> here, in the library bar, or in
          Settings to choose files, scan a folder, or open Staging from one place.
        </RouteCard>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 4 }}>
        <GoldButton onClick={onContinue}>Continue</GoldButton>
        {library ? (
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            style={{
              padding: '10px 18px', borderRadius: 999, fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
              background: 'transparent', border: '1px solid rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.4)',
              color: 'var(--onyx-accent)', cursor: 'pointer',
            }}
          >
            Add books
          </button>
        ) : (
          <span style={{ fontFamily: SANS, fontSize: 12, color: 'rgba(235,231,223,0.4)' }}>
            Create a library first to import books.
          </span>
        )}
      </div>
      {importOpen && library && (
        <LocalImportDialog st={st} library={library} onClose={() => setImportOpen(false)} />
      )}
    </div>
  );
}
