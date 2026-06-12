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
  NotificationsSection,
  BackupSection,
  ScheduledTasksSection,
} from '../components/settings';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface SettingsProps { st: OnyxState; onLogout: () => void; }

type SectionId =
  | 'account' | 'server' | 'notifications' | 'backups' | 'scheduled-tasks' | 'playback' | 'audio'
  | 'library' | 'downloads' | 'appearance' | 'keyboard' | 'about' | 'integrations';

interface NavSection { id: SectionId; label: string; icon: IconName; }

const NAV: NavSection[] = [
  { id: 'account',         label: 'Account',         icon: 'home'       },
  { id: 'server',          label: 'Server',          icon: 'monitor'    },
  { id: 'notifications',   label: 'Notifications',   icon: 'airplay'    },
  { id: 'backups',         label: 'Backups',         icon: 'bookmark'   },
  { id: 'scheduled-tasks', label: 'Scheduled Tasks', icon: 'sleep'      },
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
          {NAV.map(s => {
            // Hide admin-only sections from non-admin users
            if ((s.id === 'notifications' || s.id === 'backups' || s.id === 'scheduled-tasks') && !st.isAdmin) return null;
            // Build the label — append a count badge for Downloads when books are present.
            // This gives the user an at-a-glance view of how many books are stored offline.
            const downloadCount = s.id === 'downloads' ? st.downloads.length : 0;
            const label = downloadCount > 0 ? `${s.label} (${downloadCount})` : s.label;
            return (
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
                {label}
              </button>
            );
          })}

          <div style={{ flex: 1 }} />
        </Glass>

        {/* Content panel */}
        <Glass translucent={st.translucent} style={{ flex: 1, padding: '28px 36px', overflow: 'auto', minWidth: 0 }}>
          {section === 'account'          && <AccountSection st={st} onSignOut={handleSignOut} />}
          {section === 'server'           && <ServerSection st={st} />}
          {section === 'notifications'    && <NotificationsSection st={st} />}
          {section === 'backups'          && <BackupSection st={st} />}
          {section === 'scheduled-tasks'  && <ScheduledTasksSection st={st} />}
          {/* st is passed so the Sessions subtab can access serverUrl and user type */}
          {section === 'playback'   && <PlaybackSection st={st} />}
          {section === 'audio'      && <AudioSection />}
          {section === 'library'    && <LibrarySection st={st} />}
          {section === 'downloads'  && <DownloadsSection st={st} />}
          {section === 'appearance' && <AppearanceSection st={st} />}
          {section === 'keyboard'      && <KeyboardSection />}
          {section === 'integrations' && <IntegrationsSection st={st} />}
          {section === 'about'         && <AboutSection />}
        </Glass>
      </div>
    </div>
  );
}
