import type { OnyxState } from '../../state/onyx';
import { SectionHead, Row, Toggle, Pill } from './shared';

export interface LibrarySectionProps { st: OnyxState; }

export default function LibrarySection({ st }: LibrarySectionProps) {
  const SORTS = [
    { id: 'recently',     label: 'Recently added' },
    { id: 'title',        label: 'Title'          },
    { id: 'author',       label: 'Author'         },
    { id: 'most-listened', label: 'Most listened' },
  ];
  const SIZES = ['S', 'M', 'L', 'XL'];
  return (
    <div>
      <SectionHead title="Library" subtitle="How your collection is presented in the shelf." />
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
      <Row label="Show Home tab" hint="The dashboard-style landing view with continue listening, recent additions, and stats. Turn off to go straight to the Library.">
        <Toggle on={st.showHome} onChange={st.setShowHome} />
      </Row>
      <Row label="Show progress overlay" hint="The thin gold bar at the bottom of cover thumbnails.">
        <Toggle on={st.showProgressOverlay} onChange={st.setShowProgressOverlay} />
      </Row>
    </div>
  );
}
