import type { OnyxState } from '../../state/onyx';
import { SectionHead, Row, Toggle, Pill } from './shared';

export interface AppearanceSectionProps { st: OnyxState; }

const SCALE_OPTIONS: number[] = [90, 100, 110, 125];

export default function AppearanceSection({ st }: AppearanceSectionProps) {
  const SWATCHES = ['#d4a64a', '#c96442', '#7aa86a', '#5a8fc4', '#a86a8e'];
  const currentHex = (st.accentColor || '').toLowerCase();

  return (
    <div>
      <SectionHead title="Appearance" subtitle="The look and feel of Skald." />
      <Row label="Theme">
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'dark',   label: 'Onyx (dark)' },
            { id: 'light',  label: 'Folio (light)' },
            { id: 'system', label: 'System' },
          ].map(t => (
            <Pill key={t.id} active={st.theme === t.id} onClick={() => st.setTheme(t.id)}>{t.label}</Pill>
          ))}
        </div>
      </Row>
      <Row label="Accent color" hint="Used for active controls and progress. Applies live across the app.">
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
        </div>
      </Row>
      <Row label="Translucent surfaces" hint="The glass effect on cards. Turn off for performance on older hardware.">
        <Toggle on={st.translucent} onChange={st.setTranslucent} />
      </Row>
      <Row label="Show Home tab" hint="Display the Home tab in the navigation bar. When disabled, the app opens to Library.">
        <Toggle on={st.showHome} onChange={st.setShowHome} />
      </Row>
      <Row label="Interface scale" hint="Zooms the entire app. Useful on 4K displays or when reading from across the room.">
        <div style={{ display: 'flex', gap: 6 }}>
          {SCALE_OPTIONS.map(v => (
            <Pill key={v} active={v === st.scale} onClick={() => st.setScale(v)}>{v}%</Pill>
          ))}
        </div>
      </Row>
    </div>
  );
}
