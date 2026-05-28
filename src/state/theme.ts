// Theme token palette — fields match the CSS custom properties on :root in index.css.
// applyTheme writes every value directly to the DOM; no JS object is ever mutated.
export type Theme = {
  bg: string;
  bgDeep: string;
  panel: string;
  panel2: string;
  line: string;
  text: string;
  textDim: string;
  textMute: string;
  glass: string;
  glassStrong: string;
  glassEdge: string;
  isDark: boolean;
};

// ─── Palettes ────────────────────────────────────────────────────────────────

export const ONYX_DARK_BASE: Theme = {
  bg:          '#0b0b0e',
  bgDeep:      '#08080b',
  panel:       '#131319',
  panel2:      '#1a1a22',
  line:        'rgba(255,255,255,0.06)',
  text:        '#ebe7df',
  textDim:     'rgba(235,231,223,0.62)',
  textMute:    'rgba(235,231,223,0.38)',
  glass:       'rgba(255,255,255,0.04)',
  glassStrong: 'rgba(255,255,255,0.07)',
  glassEdge:   'rgba(255,255,255,0.09)',
  isDark:      true,
};

// Folio — warm paper light theme.
export const ONYX_FOLIO_BASE: Theme = {
  bg:          '#f4efe6',
  bgDeep:      '#ebe5d8',
  panel:       '#fbf8f2',
  panel2:      '#f1ebde',
  line:        'rgba(38,30,18,0.10)',
  text:        '#26211a',
  textDim:     'rgba(38,33,26,0.65)',
  textMute:    'rgba(38,33,26,0.42)',
  glass:       'rgba(255,253,247,0.55)',
  glassStrong: 'rgba(255,253,247,0.75)',
  glassEdge:   'rgba(38,30,18,0.10)',
  isDark:      false,
};

// ─── Color helpers ────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function lightenHex(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const lift = (c: string) =>
    Math.min(255, parseInt(c, 16) + Math.round(255 * amount))
      .toString(16)
      .padStart(2, '0');
  return `#${lift(h.slice(0, 2))}${lift(h.slice(2, 4))}${lift(h.slice(4, 6))}`;
}

// ─── Core functions ───────────────────────────────────────────────────────────

const root = () => document.documentElement;

export function setAccentColor(hex: string): void {
  const { r, g, b } = hexToRgb(hex);
  root().style.setProperty('--onyx-accent',   hex);
  root().style.setProperty('--onyx-accent-r', String(r));
  root().style.setProperty('--onyx-accent-g', String(g));
  root().style.setProperty('--onyx-accent-b', String(b));
}

export function applyTheme(theme: Theme, accentHex: string): void {
  const s = root().style;

  // Base palette tokens
  s.setProperty('--onyx-bg',           theme.bg);
  s.setProperty('--onyx-bg-deep',      theme.bgDeep);
  s.setProperty('--onyx-panel',        theme.panel);
  s.setProperty('--onyx-panel2',       theme.panel2);
  s.setProperty('--onyx-line',         theme.line);
  s.setProperty('--onyx-text',         theme.text);
  s.setProperty('--onyx-text-dim',     theme.textDim);
  s.setProperty('--onyx-text-mute',    theme.textMute);
  s.setProperty('--onyx-glass',        theme.glass);
  s.setProperty('--onyx-glass-strong', theme.glassStrong);
  s.setProperty('--onyx-glass-edge',   theme.glassEdge);

  // Derived accent tokens (alphas differ between dark and light)
  const accentDimAlpha  = theme.isDark ? 0.18 : 0.16;
  const accentEdgeAlpha = theme.isDark ? 0.35 : 0.45;
  const { r, g, b } = hexToRgb(accentHex);
  s.setProperty('--onyx-accent-bright', lightenHex(accentHex, 0.08));
  s.setProperty('--onyx-accent-dim',  `rgba(${r},${g},${b},${accentDimAlpha})`);
  s.setProperty('--onyx-accent-edge', `rgba(${r},${g},${b},${accentEdgeAlpha})`);

  // Propagate background/text to html and body so the window chrome matches
  // before React hydrates (mirrors what the prototype does in applyTheme).
  root().style.background        = theme.bg;
  document.body.style.background = theme.bg;
  document.body.style.color      = theme.text;

  setAccentColor(accentHex);
}

// ─── System theme listener ────────────────────────────────────────────────────

// Registers a prefers-color-scheme listener that re-applies the correct base
// palette whenever the OS switches mode. Call this only when the user's theme
// preference is 'system'. Returns a cleanup function.
export function watchSystemTheme(getAccent: () => string): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    const base = mq.matches ? ONYX_DARK_BASE : ONYX_FOLIO_BASE;
    applyTheme(base, getAccent());
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
