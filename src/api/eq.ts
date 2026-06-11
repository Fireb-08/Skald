import { invoke } from '@tauri-apps/api/core';

export interface EqSettings {
  enabled: boolean;
  preamp: number;
  bands: number[]; // length 10
  presetName: string | null;
}

export interface EqPreset {
  index: number;
  name: string;
}

export const getEqPresets = (): Promise<EqPreset[]> =>
  invoke('get_eq_presets');

export const getEqBandFrequencies = (): Promise<number[]> =>
  invoke('get_eq_band_frequencies');

export const getEqSettings = (): Promise<EqSettings> =>
  invoke('get_eq_settings');

export const setEqEnabled = (enabled: boolean): Promise<void> =>
  invoke('set_eq_enabled', { enabled });

export const setEqBand = (band: number, gain: number): Promise<void> =>
  invoke('set_eq_band', { band, gain });

export const setEqPreamp = (gain: number): Promise<void> =>
  invoke('set_eq_preamp', { gain });

export const applyEqPreset = (index: number): Promise<void> =>
  invoke('apply_eq_preset', { index });

export const resetEq = (): Promise<void> =>
  invoke('reset_eq');
