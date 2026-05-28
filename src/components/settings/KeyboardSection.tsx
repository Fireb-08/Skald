import { Fragment } from 'react';
import { SectionHead, MONO } from './shared';

export default function KeyboardSection() {
  const shortcuts = [
    { keys: 'Space',        desc: 'Play / pause'              },
    { keys: '←  /  →',     desc: 'Skip backward / forward'   },
    { keys: '⌘ ←  /  ⌘ →', desc: 'Previous / next chapter'  },
    { keys: '⌘ K',          desc: 'Focus search'              },
    { keys: '⌘ B',          desc: 'Bookmark current moment'   },
    { keys: '⌘ ,',          desc: 'Open settings'             },
    { keys: 'Esc',          desc: 'Back to library'           },
    { keys: '+  /  −',      desc: 'Volume up / down'          },
    { keys: 'M',            desc: 'Mute'                      },
    { keys: '1 – 5',        desc: 'Set playback speed preset' },
  ];
  return (
    <div>
      <SectionHead title="Keyboard" subtitle="Shortcuts." />
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', rowGap: 4 }}>
        {shortcuts.map(s => (
          <Fragment key={s.keys}>
            <div style={{ padding: '10px 0', fontFamily: MONO, fontSize: 12, color: 'var(--onyx-accent)', letterSpacing: '0.04em' }}>{s.keys}</div>
            <div style={{ padding: '10px 0', fontSize: 13, color: 'var(--onyx-text)', borderBottom: '1px solid var(--onyx-line)' }}>{s.desc}</div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
