import { useState, useEffect } from 'react';
import { registerShortcuts } from '../../api/abs';
import type { ShortcutBinding } from '../../api/abs';
import { DEFAULT_SHORTCUTS } from '../../hooks/useGlobalShortcuts';
import { SectionHead, MONO } from './shared';

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
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {parts.map((p, i) => (
        <kbd key={i} style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: '3px 7px',
          borderRadius: 5,
          background: 'var(--onyx-glass)',
          border: '1px solid var(--onyx-glass-edge)',
          boxShadow: '0 1px 0 var(--onyx-glass-edge)',
          fontFamily: MONO,
          fontSize: 11,
          color: 'var(--onyx-text)',
          cursor: 'pointer',
          userSelect: 'none' as const,
        }}>
          {p}
        </kbd>
      ))}
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
      registerShortcuts(newBindings).catch(console.error);
      setListeningFor(null);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [listeningFor, bindings]);

  function resetDefaults() {
    setBindings(DEFAULT_SHORTCUTS);
    localStorage.setItem('onyx.shortcuts', JSON.stringify(DEFAULT_SHORTCUTS));
    registerShortcuts(DEFAULT_SHORTCUTS).catch(console.error);
    setListeningFor(null);
  }

  return (
    <div>
      <SectionHead title="Keyboard" subtitle="Global shortcuts — work even when Skald is in the background." />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {bindings.map(b => {
          const isListening = listeningFor === b.action;
          return (
            <div
              key={b.action}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 0',
                borderBottom: '1px solid var(--onyx-line)',
                background: isListening ? 'var(--onyx-accent-dim)' : 'transparent',
                borderRadius: isListening ? 6 : 0,
                paddingLeft: isListening ? 10 : 0,
                paddingRight: isListening ? 10 : 0,
                transition: 'background 0.1s',
              }}
            >
              <div style={{ fontSize: 13.5, color: 'var(--onyx-text)', fontWeight: 500 }}>
                {ACTION_LABELS[b.action] ?? b.action}
              </div>
              <button
                onClick={() => setListeningFor(isListening ? null : b.action)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                title={isListening ? 'Press Escape to cancel' : 'Click to remap'}
              >
                <ShortcutChord shortcut={b.shortcut} active={isListening} />
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 28, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={resetDefaults}
          style={{
            padding: '7px 16px',
            background: 'transparent',
            border: '1px solid var(--onyx-glass-edge)',
            borderRadius: 7,
            color: 'var(--onyx-text-dim)',
            cursor: 'pointer',
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
