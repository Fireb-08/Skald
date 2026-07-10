import { useRef, useEffect, useState, type CSSProperties } from 'react';
import type { OnyxState } from '../../state/onyx';
import { SectionHead, Row, Toggle, Panel, Seg, SegGroup, eyebrowStyle } from './shared';
import { COVER_SIZES } from '../shelf/LibraryShelf';

export interface AppearanceSectionProps { st: OnyxState; }

const SCALE_OPTIONS: number[] = [90, 100, 110, 125];
const SORTS = [
  { id: 'recently',      label: 'Recently added' },
  { id: 'title',         label: 'Title'          },
  { id: 'author',        label: 'Author'         },
  { id: 'most-listened', label: 'Most listened'  },
];
const SIZES = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

// Accent swatches — the selectable accent colours (six, matching the reference).
const SWATCHES = ['#d4a64a', '#c96442', '#7aa86a', '#5a8fc4', '#a86a8e', '#9b7fd0'];

// Below this content width the two panels stack vertically (and the surrounding
// settings pane scrolls). Above it they sit side by side as in the reference.
const STACK_BREAKPOINT = 840;

// "Shelf tabs" sub-header inside the Shelf panel — eyebrow styling, block layout.
const subEyebrow: CSSProperties = { ...eyebrowStyle, padding: '16px 0 8px' };

export default function AppearanceSection({ st }: AppearanceSectionProps) {
  const currentHex = (st.accentColor || '').toLowerCase();

  // Responsive layout: observe the section's own width (not the window) so the
  // breakpoint reacts to the settings pane, which is narrower than the viewport.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setStacked(entries[0].contentRect.width < STACK_BREAKPOINT);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Theme panel ────────────────────────────────────────────────────────────
  const themePanel = (
    <Panel label="Theme" style={{ marginTop: 0, width: stacked ? '100%' : 380, flexShrink: 0 }}>
        <Row label="Theme">
          <SegGroup>
            {[
              { id: 'dark',   label: 'Onyx' },
              { id: 'light',  label: 'Folio' },
              { id: 'system', label: 'System' },
            ].map(t => (
              <Seg key={t.id} active={st.theme === t.id} onClick={() => st.setTheme(t.id)}>{t.label}</Seg>
            ))}
          </SegGroup>
        </Row>

        <Row label="Accent color" hint="Used for active controls and progress indicators.">
          <div style={{ display: 'flex', gap: 10 }}>
            {SWATCHES.map(c => {
              const active = c.toLowerCase() === currentHex;
              return (
                <button
                  key={c}
                  onClick={() => st.setAccentColor(c)}
                  title={c}
                  aria-label={`Set accent color ${c}`}
                  style={{
                    width: 26, height: 26, borderRadius: 13, background: c, cursor: 'pointer',
                    border: active ? '2px solid #ebe7df' : '1px solid rgba(0,0,0,0.4)',
                    boxShadow: active ? `0 0 14px ${c}88` : 'none',
                    padding: 0, transition: 'transform 0.12s, box-shadow 0.15s',
                    transform: active ? 'scale(1.08)' : 'scale(1)',
                  }}
                />
              );
            })}
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(currentHex) ? currentHex : SWATCHES[0]}
              onChange={e => st.setAccentColor(e.target.value)}
              aria-label="Choose custom accent color"
              title="Custom accent color"
              style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--onyx-glass-edge)', borderRadius: 14, background: 'transparent', cursor: 'pointer' }}
            />
          </div>
        </Row>

        <Row label="Interface scale" hint="Scales the entire app. Useful on 4K displays.">
          <SegGroup>
            {SCALE_OPTIONS.map(v => (
              <Seg key={v} active={v === st.scale} onClick={() => st.setScale(v)}>{v}%</Seg>
            ))}
          </SegGroup>
        </Row>

        <Row label="Translucent surfaces" hint="Glass effect on cards. Disable for performance on older hardware.">
          <Toggle on={st.translucent} onChange={st.setTranslucent} />
        </Row>
    </Panel>
  );

  // ── Shelf panel ────────────────────────────────────────────────────────────
  const shelfPanel = (
    <Panel label="Shelf" style={{ marginTop: 0, width: stacked ? '100%' : 'auto', flex: stacked ? '0 0 auto' : 1, minWidth: 0 }}>
        <Row label="Default sort">
          <SegGroup>
            {SORTS.map(s => (
              <Seg key={s.id} active={s.id === st.librarySort} onClick={() => st.setLibrarySort(s.id)}>{s.label}</Seg>
            ))}
          </SegGroup>
        </Row>

        <Row label="Cover size">
          <SegGroup>
            {SIZES.map(v => (
              <Seg key={v} active={v === st.coverSize} onClick={() => st.setCoverSize(v)}>{v} · {COVER_SIZES[v]} px</Seg>
            ))}
          </SegGroup>
        </Row>

        <Row label="Browse tile style" hint="How series, authors, genres and other shelf tabs present each group.">
          <SegGroup>
            {[
              { id: 'stack',  label: 'Stack' },
              { id: 'mosaic', label: 'Mosaic' },
            ].map(t => (
              <Seg key={t.id} active={st.browseTileStyle === t.id} onClick={() => st.setBrowseTileStyle(t.id as 'stack' | 'mosaic')}>{t.label}</Seg>
            ))}
          </SegGroup>
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

        {/* Only meaningful when there are two stats sources to combine: an ABS
            login AND at least one local library (Local Listening Stats roadmap). */}
        {!!st.serverUrl && st.libraries.some(l => l.source === 'local') && (
          <Row
            label="Combine listening stats"
            hint="Merge server and on-this-PC listening into one “Your stats” view. Off: the stats card follows the active library."
          >
            <Toggle on={st.combineStats} onChange={st.setCombineStats} />
          </Row>
        )}

        {/* Optional shelf tabs (Home/Series/Authors/Collections are always shown) */}
        <div style={subEyebrow}>Shelf tabs</div>

        <Row label="Narrators tab" hint="Show the Narrators tab on the library shelf.">
          <Toggle on={!!st.optionalTabs.narrators} onChange={v => st.setOptionalTab('narrators', v)} />
        </Row>
        <Row label="Genres tab" hint="Show the Genres tab on the library shelf.">
          <Toggle on={!!st.optionalTabs.genres} onChange={v => st.setOptionalTab('genres', v)} />
        </Row>
        <Row label="Publishers tab" hint="Show the Publishers tab on the library shelf.">
          <Toggle on={!!st.optionalTabs.publishers} onChange={v => st.setOptionalTab('publishers', v)} />
        </Row>
        <Row label="Playlists tab" hint="Show the Playlists tab on the library shelf.">
          <Toggle on={!!st.optionalTabs.playlists} onChange={v => st.setOptionalTab('playlists', v)} />
        </Row>
    </Panel>
  );

  return (
    <div ref={rootRef}>
      <SectionHead title="Appearance" subtitle="The look and feel of Skald — theme, and how your shelf is presented." />

      {/* Two glass panels: side by side at high resolution, stacked (with the
          settings pane scrolling) at low resolution. */}
      <div style={{ display: 'flex', flexDirection: stacked ? 'column' : 'row', gap: 24, alignItems: 'flex-start', maxWidth: 1080 }}>
        {themePanel}
        {shelfPanel}
      </div>
    </div>
  );
}
