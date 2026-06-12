import { useState } from 'react';
import type { OnyxState } from '../../state/onyx';
import { SectionHead, Row, Toggle, Pill, MONO } from './shared';
import LibrariesSection from './LibrariesSection';

type LibraryTab = 'display' | 'manage';

export interface LibrarySectionProps { st: OnyxState; }

export default function LibrarySection({ st }: LibrarySectionProps) {
  const [tab, setTab] = useState<LibraryTab>(() => {
    const stored = localStorage.getItem('onyx.library.tab');
    return (stored === 'manage' && st.isAdmin ? 'manage' : 'display') as LibraryTab;
  });

  const switchTab = (t: LibraryTab) => {
    localStorage.setItem('onyx.library.tab', t);
    setTab(t);
  };

  const SORTS = [
    { id: 'recently',      label: 'Recently added' },
    { id: 'title',         label: 'Title'          },
    { id: 'author',        label: 'Author'         },
    { id: 'most-listened', label: 'Most listened'  },
  ];
  const SIZES = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

  return (
    <div>
      <SectionHead title="Library" subtitle="How your collection is presented in the shelf." />

      {/* Subtab toggle — only rendered for admin/root users who have a Manage tab */}
      {st.isAdmin && (
        <div style={{
          display: 'flex',
          padding: 3,
          gap: 3,
          background: 'var(--onyx-glass)',
          border: '1px solid var(--onyx-glass-edge)',
          borderRadius: 10,
          marginBottom: 28,
          width: 'fit-content',
        }}>
          {([{ id: 'display', label: 'Display' }, { id: 'manage', label: 'Manage' }] as const).map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
                style={{
                  padding: '7px 18px',
                  borderRadius: 7,
                  cursor: 'pointer',
                  border: 'none',
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: active ? 600 : 400,
                  letterSpacing: '0.04em',
                  background: active ? 'var(--onyx-accent-dim)' : 'transparent',
                  boxShadow: active ? 'inset 0 0 0 1px var(--onyx-accent-edge)' : 'none',
                  color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Manage tab — server-side library management (admin only) */}
      {tab === 'manage' && st.isAdmin && <LibrariesSection st={st} />}

      {/* Display tab — shelf presentation preferences */}
      {tab === 'display' && (<>
        <Row label="Default sort">
          <div style={{ display: 'flex', gap: 6 }}>
            {SORTS.map(s => (
              <Pill key={s.id} active={s.id === st.librarySort} onClick={() => st.setLibrarySort(s.id)}>{s.label}</Pill>
            ))}
          </div>
        </Row>
        <Row label="Cover size">
          <div style={{ display: 'flex', gap: 6 }}>
            {SIZES.map(v => (
              <Pill key={v} active={v === st.coverSize} onClick={() => st.setCoverSize(v)}>{v}</Pill>
            ))}
          </div>
        </Row>
        <Row label="Group by series" hint="Stack series volumes under a single cover.">
          <Toggle on={st.groupBySeries} onChange={st.setGroupBySeries} />
        </Row>
        <Row label="Show finished titles" hint="Include books at 100% in the main grid.">
          <Toggle on={st.showFinished} onChange={st.setShowFinished} />
        </Row>
        <Row label="Show progress overlay" hint="The thin gold bar at the bottom of cover thumbnails.">
          <Toggle on={st.showProgressOverlay} onChange={st.setShowProgressOverlay} />
        </Row>
      </>)}
    </div>
  );
}
