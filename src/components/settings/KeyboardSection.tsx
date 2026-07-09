import { useState, useEffect } from 'react';
import { registerShortcuts } from '../../api/abs';
import type { ShortcutBinding } from '../../api/abs';
import { DEFAULT_SHORTCUTS } from '../../hooks/useGlobalShortcuts';
import { SectionHead, MONO, SERIF, Panel } from './shared';
import { log } from '../../lib/log';

const ACTION_LABELS: Record<string, string> = {
  play_pause:   'Play / Pause',
  skip_forward: 'Skip Forward',
  skip_back:    'Skip Back',
  volume_up:    'Volume Up',
  volume_down:  'Volume Down',
  mute:         'Mute',
};

function loadBindings(): ShortcutBinding[] {
  try {
    const raw = localStorage.getItem('onyx.shortcuts');
    if (raw) return JSON.parse(raw) as ShortcutBinding[];
  } catch { /* fall through */ }
  return DEFAULT_SHORTCUTS;
}

function keyCodeToName(code: string): string {
  const map: Record<string, string> = {
    ArrowLeft: 'Left', ArrowRight: 'Right',
    ArrowUp: 'Up', ArrowDown: 'Down',
    Space: 'Space',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

function buildShortcutString(e: KeyboardEvent): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey)  parts.push('Ctrl');
  if (e.altKey)   parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey)  parts.push('Meta');
  parts.push(keyCodeToName(e.code));
  return parts.join('+');
}

// Display-only key glyphs (the stored binding string keeps the textual names).
const KEY_GLYPHS: Record<string, string> = { Left: '←', Right: '→', Up: '↑', Down: '↓' };
const displayKey = (part: string): string => KEY_GLYPHS[part] ?? part;

// Base keycap; modifiers render neutral, the final (main) key renders accent gold.
const keycapBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  minWidth: 24, padding: '4px 9px', borderRadius: 5, lineHeight: 1,
  fontFamily: MONO, fontSize: 11, userSelect: 'none',
};
const modCap: React.CSSProperties = {
  ...keycapBase, background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
  boxShadow: '0 1px 0 var(--onyx-glass-edge)', color: 'var(--onyx-text-dim)',
};
const mainCap: React.CSSProperties = {
  ...keycapBase, background: 'var(--onyx-accent-dim)', border: '1px solid var(--onyx-accent-edge)',
  boxShadow: '0 1px 0 rgba(0,0,0,0.3)', color: 'var(--onyx-accent)',
};

function ShortcutChord({ shortcut, active }: { shortcut: string; active: boolean }) {
  if (active) {
    return (
      <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-accent)', letterSpacing: '0.06em' }}>
        Press a key combination…
      </span>
    );
  }
  const parts = shortcut.split('+');
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {parts.map((p, i) => {
        const isLast = i === parts.length - 1;
        return (
          <span key={i} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {i > 0 && <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)' }}>+</span>}
            <kbd style={isLast ? mainCap : modCap}>{displayKey(p)}</kbd>
          </span>
        );
      })}
    </span>
  );
}

export default function KeyboardSection() {
  const [bindings, setBindings] = useState<ShortcutBinding[]>(loadBindings);
  const [listeningFor, setListeningFor] = useState<string | null>(null);

  useEffect(() => {
    if (!listeningFor) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setListeningFor(null);
        return;
      }

      const shortcut = buildShortcutString(e);
      if (!shortcut) return;

      const newBindings = bindings.map(b =>
        b.action === listeningFor ? { ...b, shortcut } : b,
      );
      setBindings(newBindings);
      localStorage.setItem('onyx.shortcuts', JSON.stringify(newBindings));
      registerShortcuts(newBindings).catch(e => log.error('playback', 'register shortcuts failed', { err: String(e) }));
      setListeningFor(null);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [listeningFor, bindings]);

  function resetDefaults() {
    setBindings(DEFAULT_SHORTCUTS);
    localStorage.setItem('onyx.shortcuts', JSON.stringify(DEFAULT_SHORTCUTS));
    registerShortcuts(DEFAULT_SHORTCUTS).catch(e => log.error('playback', 'reset shortcuts to defaults failed', { err: String(e) }));
    setListeningFor(null);
  }

  return (
    <div>
      <SectionHead title="Keyboard" subtitle="Global shortcuts — work even when Skald is in the background." />

      <Panel label="Global shortcuts">
        {bindings.map(b => {
          const isListening = listeningFor === b.action;
          return (
            <div
              key={b.action}
              onClick={() => setListeningFor(isListening ? null : b.action)}
              title={isListening ? 'Press Escape to cancel' : 'Click to remap'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                cursor: 'pointer', transition: 'background 0.1s',
                borderBottom: '1px solid var(--onyx-line)',
                // When listening, the accent highlight extends slightly into the panel
                // padding (negative margin offsets the extra padding so content stays put).
                ...(isListening
                  ? { background: 'var(--onyx-accent-dim)', borderRadius: 8, borderBottomColor: 'transparent', padding: '14px 12px', margin: '0 -12px' }
                  : { padding: '14px 2px' }),
              }}
            >
              <span style={{ fontFamily: SERIF, fontSize: 15, color: 'var(--onyx-text)' }}>
                {ACTION_LABELS[b.action] ?? b.action}
              </span>
              <ShortcutChord shortcut={b.shortcut} active={isListening} />
            </div>
          );
        })}

        {/* Footer: system-wide note + reset */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 2px 6px' }}>
          <span style={{ fontSize: 12, color: 'var(--onyx-text-mute)', lineHeight: 1.4 }}>
            Shortcuts are registered system-wide and may conflict with other apps.
          </span>
          <button
            onClick={resetDefaults}
            style={{
              flexShrink: 0,
              padding: '7px 15px',
              background: 'transparent',
              border: '1px solid var(--onyx-glass-edge)',
              borderRadius: 7,
              color: 'var(--onyx-text-dim)',
              cursor: 'pointer',
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
            }}
          >
            Reset to defaults
          </button>
        </div>
      </Panel>
    </div>
  );
}
