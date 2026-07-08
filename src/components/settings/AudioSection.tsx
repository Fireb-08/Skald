import { useState, useEffect } from 'react';
import { getAudioDevices, setAudioDevice as setAudioDeviceCmd } from '../../api/abs';
import type { AudioDevice } from '../../api/abs';
import {
  getEqSettings, getEqPresets, getEqBandFrequencies,
  setEqEnabled, setEqBand, setEqPreamp, applyEqPreset, resetEq,
} from '../../api/eq';
import type { EqSettings, EqPreset } from '../../api/eq';
import Icon from '../Icon';
import { SectionHead, Row, Toggle, MONO, Panel, Seg, eyebrowStyle } from './shared';
import Dropdown from './Dropdown';

function formatHz(hz: number): string {
  if (hz >= 1000) return `${hz / 1000}k`;
  return `${hz}`;
}

function formatGain(g: number): string {
  if (g === 0) return '0';
  const r = Math.round(g * 10) / 10;
  return r > 0 ? `+${r}` : `${r}`;
}

// ── EQ response-curve graph ───────────────────────────────────────────────────
const GRAPH_H = 150;   // svg plot height (matches the band-slider track height)
const GRAPH_MAX = 12;  // ± dB shown on the graph / band scale

// Number of lowest band sliders to hide. The bottom of LibVLC's 10-band scale is
// sub-bass (31.25 Hz at index 0) — inaudible on most playback systems and below
// the speech range, so the control does effectively nothing on audiobook content.
// We drop it from both the sliders and the response graph; the band still exists
// in the backend (it stays at whatever presets/Reset set it to, ~flat), we just
// stop exposing a control that "barely affects the audio".
const HIDDEN_LOW_BANDS = 1;

/** Catmull-Rom → cubic-bezier smoothing through the band points. */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0][0]} ${pts[0][1]}` : '';
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] ?? pts[i];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[i + 2] ?? pts[i + 1];
    const c1x = x1 + (x2 - x0) / 6, c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6, c2y = y2 - (y3 - y1) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  return d;
}

/** Live response curve drawn from the current band gains. Uses a fixed viewBox
 *  stretched with preserveAspectRatio=none; strokes stay crisp via
 *  vector-effect=non-scaling-stroke, and the dB labels are HTML in the gutter. */
function EqGraph({ bands }: { bands: number[] }) {
  const W = 1000, H = GRAPH_H, padY = 14;
  const n = bands.length || 1;
  const yFor = (g: number) => {
    const c = Math.max(-GRAPH_MAX, Math.min(GRAPH_MAX, g));
    return H / 2 - (c / GRAPH_MAX) * (H / 2 - padY);
  };
  const pts: Array<[number, number]> = bands.map((g, i) => [n === 1 ? W / 2 : (i / (n - 1)) * W, yFor(g)]);
  const line = smoothPath(pts);
  const area = pts.length ? `${line} L ${W} ${H} L 0 ${H} Z` : '';
  const yTop = yFor(GRAPH_MAX), y0 = yFor(0), yBot = yFor(-GRAPH_MAX);

  return (
    <div style={{ position: 'relative', paddingLeft: 34 }}>
      {/* dB axis labels in the left gutter */}
      <div style={{ position: 'absolute', left: 0, top: 0, height: H, width: 30, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: `${padY - 5}px 0`, alignItems: 'flex-end', pointerEvents: 'none' }}>
        {['+12', '0', '-12'].map(l => (
          <span key={l} style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>{l}</span>
        ))}
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--onyx-accent)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--onyx-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* grid lines: top (+12), zero (brighter), bottom (-12) */}
        {[yTop, y0, yBot].map((y, i) => (
          <line key={i} x1="0" y1={y} x2={W} y2={y} stroke="var(--onyx-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={i === 1 ? 0.9 : 0.45} />
        ))}
        {area && <path d={area} fill="url(#eq-fill)" />}
        {line && <path d={line} fill="none" stroke="var(--onyx-accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />}
      </svg>
    </div>
  );
}

export interface AudioSectionProps {}

export default function AudioSection() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [eqSettings, setEqSettings] = useState<EqSettings | null>(null);
  const [presets, setPresets] = useState<EqPreset[]>([]);
  const [frequencies, setFrequencies] = useState<number[]>([]);
  // Local copies so sliders/graph update instantly during drag without invoking Tauri on every tick.
  const [localBands, setLocalBands] = useState<number[]>(Array(10).fill(0));
  const [localPreamp, setLocalPreamp] = useState(0);

  useEffect(() => {
    getAudioDevices()
      .then(list => {
        setDevices(list);
        setSelectedId(prev => prev ?? list[0]?.id ?? null);
      })
      .catch(console.error);

    Promise.all([getEqSettings(), getEqPresets(), getEqBandFrequencies()])
      .then(([s, p, f]) => {
        setEqSettings(s);
        setPresets(p);
        setFrequencies(f);
        setLocalBands([...s.bands]);
        setLocalPreamp(s.preamp);
      })
      .catch(console.error);
  }, []);

  const currentDevice = devices.find(d => d.id === selectedId);

  function selectDevice(id: string) {
    setSelectedId(id);
    setAudioDeviceCmd(id).catch(console.error);
  }

  function handleToggleEq(enabled: boolean) {
    setEqSettings(s => s ? { ...s, enabled } : s);
    setEqEnabled(enabled).catch(console.error);
  }

  function handlePresetChange(idx: number) {
    applyEqPreset(idx)
      .then(() => getEqSettings())
      .then(s => {
        setEqSettings(s);
        setLocalBands([...s.bands]);
        setLocalPreamp(s.preamp);
      })
      .catch(console.error);
  }

  function handleResetFlat() {
    resetEq()
      .then(() => getEqSettings())
      .then(s => {
        setEqSettings(s);
        setLocalBands([...s.bands]);
        setLocalPreamp(s.preamp);
      })
      .catch(console.error);
  }

  function handleBandCommit(i: number, gain: number) {
    setEqSettings(s => {
      if (!s) return s;
      const bands = [...s.bands];
      bands[i] = gain;
      return { ...s, bands, presetName: null };
    });
    setEqBand(i, gain).catch(console.error);
  }

  function handlePreampCommit(gain: number) {
    setEqSettings(s => s ? { ...s, preamp: gain } : s);
    setEqPreamp(gain).catch(console.error);
  }

  const eqEnabled = eqSettings?.enabled ?? false;

  // '__custom__' when bands were manually adjusted (presetName === null);
  // otherwise the index of the matching preset.
  const presetSelectValue = (() => {
    if (!eqSettings || eqSettings.presetName === null) return '__custom__';
    const match = presets.find(p => p.name === eqSettings.presetName);
    return match ? String(match.index) : '__custom__';
  })();

  // Band-slider layout heights — used to align the left dB scale with the tracks.
  const FREQ_H = 18, TRACK_H = GRAPH_H, VAL_H = 18;

  return (
    <div>
      <SectionHead title="Audio" subtitle="Output device and signal-chain preferences." />

      {/* Output device — kept as a standalone line item above the signal chain. */}
      <Row
        label="Output device"
        hint="Active right now. Pick a different device any time from the toolbar."
        align="top"
      >
        {devices.length === 0 ? (
          <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', padding: '8px 12px', letterSpacing: '0.06em' }}>
            Loading devices…
          </div>
        ) : (
          <Dropdown
            trigger={
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="headphones" size={13} color="var(--onyx-text-dim)" />
                <span>{currentDevice?.name ?? 'Select device'}</span>
              </span>
            }
            items={devices.map(d => ({ id: d.id, name: d.name, icon: 'headphones' }))}
            selected={selectedId}
            onChange={selectDevice}
            align="right"
          />
        )}
      </Row>

      {/* ── Signal chain panel ── */}
      <Panel label="Signal chain" bodyStyle={{ padding: '2px 20px 18px' }}>
          {/* Equalizer master toggle */}
          <Row label="Equalizer" hint="9-band DSP equalizer powered by LibVLC. Changes apply live.">
            {eqSettings !== null && <Toggle on={eqEnabled} onChange={handleToggleEq} />}
          </Row>

          {/* EQ controls — greyed and non-interactive while disabled */}
          <div style={{ opacity: eqEnabled ? 1 : 0.35, pointerEvents: eqEnabled ? 'auto' : 'none', transition: 'opacity 0.2s' }}>
            {/* Preset pills (replaces the dropdown) */}
            <Row label="Preset">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {presets.map(p => (
                  <Seg key={p.index} active={presetSelectValue === String(p.index)} onClick={() => handlePresetChange(p.index)}>{p.name}</Seg>
                ))}
                {/* Custom is an indicator (active when bands were hand-tuned), not directly applicable. */}
                <Seg active={presetSelectValue === '__custom__'} onClick={() => {}}>Custom</Seg>
              </div>
            </Row>

            {/* Preamp */}
            <Row label="Preamp">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <input
                  type="range"
                  min={-20}
                  max={20}
                  step={0.5}
                  value={localPreamp}
                  onChange={e => setLocalPreamp(Number(e.target.value))}
                  onPointerUp={e => handlePreampCommit(Number((e.target as HTMLInputElement).value))}
                  style={{ width: 280, accentColor: 'var(--onyx-accent)', cursor: 'pointer' }}
                />
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-dim)', minWidth: 48, textAlign: 'right' }}>
                  {formatGain(localPreamp)} dB
                </span>
              </div>
            </Row>

            {/* 10-band EQ: sub-header + reset, response graph, then the band sliders */}
            {frequencies.length > 0 && (
              <div style={{ paddingTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span style={eyebrowStyle}>9-Band EQ</span>
                  <button
                    onClick={handleResetFlat}
                    style={{
                      padding: '5px 11px', borderRadius: 6, background: 'transparent',
                      border: '1px solid var(--onyx-glass-edge)', color: 'var(--onyx-text-dim)',
                      fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
                    }}
                  >
                    Reset to flat
                  </button>
                </div>

                {/* Live response curve — sliced to the visible bands so the curve
                    lines up with the slider columns below it. */}
                <EqGraph bands={localBands.slice(HIDDEN_LOW_BANDS)} />

                {/* Band sliders with a left dB scale aligned to the tracks */}
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  {/* dB scale column */}
                  <div style={{ width: 24, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ height: FREQ_H }} />
                    <div style={{ height: TRACK_H, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                      {['+12', '+6', '0', '-6', '-12'].map(l => (
                        <span key={l} style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em', lineHeight: 1 }}>{l}</span>
                      ))}
                    </div>
                    <div style={{ height: VAL_H }} />
                  </div>

                  {/* Sliders — the lowest HIDDEN_LOW_BANDS columns are omitted; the
                      real band index `i` is preserved so value binding/commit and
                      the backend band mapping stay correct. */}
                  <div style={{ flex: 1, display: 'flex', gap: 4 }}>
                    {frequencies.slice(HIDDEN_LOW_BANDS).map((hz, j) => {
                      const i = j + HIDDEN_LOW_BANDS;
                      const gain = localBands[i] ?? 0;
                      return (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span style={{ height: FREQ_H, lineHeight: `${FREQ_H}px`, fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>
                            {formatHz(hz)}
                          </span>
                          <input
                            type="range"
                            min={-GRAPH_MAX}
                            max={GRAPH_MAX}
                            step={0.5}
                            value={gain}
                            onChange={e => {
                              const v = Number(e.target.value);
                              setLocalBands(prev => { const next = [...prev]; next[i] = v; return next; });
                            }}
                            onPointerUp={e => handleBandCommit(i, Number((e.target as HTMLInputElement).value))}
                            className="onyx-eq-slider"
                            style={{
                              writingMode: 'vertical-lr',
                              direction: 'rtl',
                              height: TRACK_H,
                              width: 24,
                              cursor: 'pointer',
                              accentColor: 'var(--onyx-accent)',
                            } as React.CSSProperties}
                          />
                          <span style={{ height: VAL_H, lineHeight: `${VAL_H}px`, fontFamily: MONO, fontSize: 9, color: gain !== 0 ? 'var(--onyx-text-dim)' : 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>
                            {formatGain(gain)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
    </Panel>
    </div>
  );
}
