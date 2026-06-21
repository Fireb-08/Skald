// LibraryManagementSection — folds the two "Libraries" surfaces under one settings
// entry and presents each as its OWN glass pane, mirroring the Appearance tab's
// Theme/Shelf panes: a single "Libraries" header, then two panes that sit side by
// side when wide and stack when narrow.
//
//   • Audiobookshelf server (LibrariesSection) — admin only.
//   • On this PC          (LocalLibrarySection) — always available.
//
// Each section is rendered `embedded` (its own SectionHead hidden) inside a
// PanelFlatContext provider, so its internal sub-panels render flat (eyebrow
// dividers) and the wrapper Panel is the single glass surface for the whole pane.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { OnyxState } from '../../state/onyx';
import LibrariesSection from './LibrariesSection';
import LocalLibrarySection from './LocalLibrarySection';
import { SectionHead, Panel, PanelFlatContext } from './shared';

export interface LibraryManagementSectionProps { st: OnyxState; }

// Above this content width the two panes sit side by side. Higher than the
// Appearance breakpoint (840) because each library pane carries denser forms.
const MULTIPANE_BREAKPOINT = 1040;

export default function LibraryManagementSection({ st }: LibraryManagementSectionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [sideBySide, setSideBySide] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setSideBySide(entries[0].contentRect.width >= MULTIPANE_BREAKPOINT);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One glass pane hosting an embedded section whose inner Panels render flat.
  const pane = (label: string, content: ReactNode, style: CSSProperties): ReactNode => (
    <Panel label={label} style={style}>
      <PanelFlatContext.Provider value={true}>{content}</PanelFlatContext.Provider>
    </Panel>
  );

  // Non-admin: only the local pane exists.
  if (!st.isAdmin) {
    return (
      <div ref={rootRef}>
        <SectionHead title="Libraries" subtitle="The local libraries on this computer." />
        {pane('On this PC', <LocalLibrarySection st={st} embedded />, { marginTop: 0 })}
      </div>
    );
  }

  const colStyle: CSSProperties = sideBySide
    ? { marginTop: 0, flex: 1, minWidth: 0 }
    : { marginTop: 0, width: '100%' };

  return (
    <div ref={rootRef}>
      <SectionHead
        title="Libraries"
        subtitle="Your Audiobookshelf server libraries and the local libraries on this computer."
      />
      <div style={{ display: 'flex', flexDirection: sideBySide ? 'row' : 'column', gap: 24, alignItems: 'flex-start' }}>
        {pane('Audiobookshelf server', <LibrariesSection st={st} embedded />, colStyle)}
        {pane('On this PC', <LocalLibrarySection st={st} embedded />, colStyle)}
      </div>
    </div>
  );
}
