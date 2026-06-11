import { useState, useEffect } from 'react';
import { getAudioDevices, setAudioDevice as setAudioDeviceCmd } from '../../api/abs';
import type { AudioDevice } from '../../api/abs';
import {
  getEqSettings, getEqPresets, getEqBandFrequencies,
  setEqEnabled, setEqBand, setEqPreamp, applyEqPreset,
} from '../../api/eq';
import type { EqSettings, EqPreset } from '../../api/eq';
import Icon from '../Icon';
import { SectionHead, Row, Toggle, MONO } from './shared';
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

export interface AudioSectionProps {}

export default function AudioSection() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [eqSettings, setEqSettings] = useState<EqSettings | null>(null);
  const [presets, setPresets] = useState<EqPreset[]>([]);
  const [frequencies, setFrequencies] = useState<number[]>([]);
  // Local copies so sliders update instantly during drag without invoking Tauri on every tick.
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

  return (
    <div>
      <SectionHead title="Audio" subtitle="Output device and signal-chain preferences." />

      <Row
        label="Output device"
        hint="Active right now. Pick a different device any time from the toolbar."
        align="top"
      >
        {devices.length === 0 ? (
          <div style={{
            fontFamily: MONO, fontSize: 11,
            color: 'var(--onyx-text-mute)',
            padding: '8px 12px', letterSpacing: '0.06em',
          }}>
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

      <Row label="Equalizer" hint="10-band DSP equalizer powered by LibVLC. Changes apply live.">
        {eqSettings !== null && (
          <Toggle on={eqEnabled} onChange={handleToggleEq} />
        )}
      </Row>

      {/* EQ controls — greyed and non-interactive while disabled */}
      <div style={{
        opacity: eqEnabled ? 1 : 0.35,
        pointerEvents: eqEnabled ? 'auto' : 'none',
        transition: 'opacity 0.2s',
      }}>
        <Row label="Preset">
          <select
            className="onyx-select"
            value={presetSelectValue}
            onChange={e => {
              const v = e.target.value;
              if (v !== '__custom__') handlePresetChange(parseInt(v, 10));
            }}
          >
            <option value="__custom__">Custom</option>
            {presets.map(p => (
              <option key={p.index} value={String(p.index)}>{p.name}</option>
            ))}
          </select>
        </Row>

        <Row label="Preamp">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="range"
              min={-20}
              max={20}
              step={0.5}
              value={localPreamp}
              onChange={e => setLocalPreamp(Number(e.target.value))}
              onPointerUp={e => handlePreampCommit(Number((e.target as HTMLInputElement).value))}
              style={{ width: 200, accentColor: 'var(--onyx-accent)', cursor: 'pointer' }}
            />
            <span style={{
              fontFamily: MONO, fontSize: 11,
              color: 'var(--onyx-text-dim)',
              minWidth: 52, textAlign: 'right',
            }}>
              {formatGain(localPreamp)} dB
            </span>
          </div>
        </Row>

        {/* 10 vertical band sliders */}
        {frequencies.length > 0 && (
          <div style={{ padding: '16px 0 20px', borderBottom: '1px solid var(--onyx-line)' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {frequencies.map((hz, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span style={{
                    fontFamily: MONO, fontSize: 9,
                    color: 'var(--onyx-text-mute)',
                    letterSpacing: '0.04em',
                  }}>
                    {formatHz(hz)}
                  </span>
                  <input
                    type="range"
                    min={-20}
                    max={20}
                    step={0.5}
                    value={localBands[i] ?? 0}
                    onChange={e => {
                      const gain = Number(e.target.value);
                      setLocalBands(prev => {
                        const next = [...prev];
                        next[i] = gain;
                        return next;
                      });
                    }}
                    onPointerUp={e =>
                      handleBandCommit(i, Number((e.target as HTMLInputElement).value))
                    }
                    className="onyx-eq-slider"
                    style={{
                      writingMode: 'vertical-lr',
                      direction: 'rtl',
                      height: 120,
                      width: 24,
                      cursor: 'pointer',
                      accentColor: 'var(--onyx-accent)',
                    } as React.CSSProperties}
                  />
                  <span style={{
                    fontFamily: MONO, fontSize: 9,
                    color: 'var(--onyx-text-dim)',
                    letterSpacing: '0.04em',
                  }}>
                    {formatGain(localBands[i] ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
