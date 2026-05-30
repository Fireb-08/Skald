import { useState } from 'react';
import type { OnyxState } from '../state/onyx';
import { logout } from '../api/abs';
import Glass from '../components/chrome/Glass';
import Icon from '../components/Icon';
import type { IconName } from '../components/Icon';
import {
  AccountSection,
  ServerSection,
  PlaybackSection,
  AudioSection,
  LibrarySection,
  DownloadsSection,
  AppearanceSection,
  KeyboardSection,
  AboutSection,
  IntegrationsSection,
} from '../components/settings';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface SettingsProps { st: OnyxState; onLogout: () => void; }

type SectionId =
  | 'account' | 'server' | 'playback' | 'audio'
  | 'library' | 'downloads' | 'appearance' | 'keyboard' | 'about' | 'integrations';

interface NavSection { id: SectionId; label: string; icon: IconName; }

const NAV: NavSection[] = [
  { id: 'account',    label: 'Account',    icon: 'home'       },
  { id: 'server',     label: 'Server',     icon: 'monitor'    },
  { id: 'playback',   label: 'Playback',   icon: 'play'       },
  { id: 'audio',      label: 'Audio',      icon: 'headphones' },
  { id: 'library',    label: 'Library',    icon: 'grid'       },
  { id: 'downloads',  label: 'Downloads',  icon: 'bookmark'   },
  { id: 'appearance', label: 'Appearance', icon: 'speaker'    },
  { id: 'keyboard',   label: 'Keyboard',   icon: 'kbd'        },
  { id: 'integrations', label: 'Integrations', icon: 'airplay'  },
  { id: 'about',        label: 'About',        icon: 'dot'      },
];

export default function Settings({ st, onLogout }: SettingsProps) {
  const [section, setSection] = useState<SectionId>('account');

  async function handleSignOut() {
    try { await logout(); } catch { /* keyring failure is non-fatal */ }
    localStorage.removeItem('skald.authToken');
    localStorage.removeItem('skald.serverUrl');
    localStorage.removeItem('skald.userId');
    localStorage.removeItem('skald.username');
    localStorage.removeItem('skald.sessionId');
    onLogout();
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 32px 24px', minHeight: 0 }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>
        <button
          onClick={() => st.setScreen('library')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--onyx-text-dim)', cursor: 'pointer', padding: 4, fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' as const }}
        >
          <Icon name="chevron-left" size={12} /> Library
        </button>
        <span>·</span>
        <span style={{ color: 'var(--onyx-text)' }}>Settings</span>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 24, minHeight: 0 }}>
        {/* Sidebar */}
        <Glass translucent={st.translucent} style={{ width: 260, padding: '20px 14px', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          {/* Profile header */}
          <div style={{ padding: '4px 10px 18px', borderBottom: '1px solid var(--onyx-line)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15 }}>J</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--onyx-text)' }}>Jordan</div>
              <div style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>jordan@home.lan</div>
            </div>
          </div>

          {/* Nav items */}
          {NAV.map(s => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '9px 12px', borderRadius: 8,
                background: section === s.id ? 'var(--onyx-accent-dim)' : 'transparent',
                border: `1px solid ${section === s.id ? 'var(--onyx-accent-edge)' : 'transparent'}`,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' as const,
                color: section === s.id ? 'var(--onyx-accent)' : 'var(--onyx-text)',
                fontSize: 13, fontWeight: section === s.id ? 500 : 400,
                marginBottom: 2,
              }}
            >
              <Icon name={s.icon} size={14} color={section === s.id ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)'} />
              {s.label}
            </button>
          ))}

          <div style={{ flex: 1 }} />
        </Glass>

        {/* Content panel */}
        <Glass translucent={st.translucent} style={{ flex: 1, padding: '28px 36px', overflow: 'auto', minWidth: 0 }}>
          {section === 'account'    && <AccountSection st={st} onSignOut={handleSignOut} />}
          {section === 'server'     && <ServerSection />}
          {section === 'playback'   && <PlaybackSection st={st} />}
          {section === 'audio'      && <AudioSection st={st} />}
          {section === 'library'    && <LibrarySection st={st} />}
          {section === 'downloads'  && <DownloadsSection />}
          {section === 'appearance' && <AppearanceSection st={st} />}
          {section === 'keyboard'      && <KeyboardSection />}
          {section === 'integrations' && <IntegrationsSection st={st} />}
          {section === 'about'         && <AboutSection />}
        </Glass>
      </div>
    </div>
  );
}
