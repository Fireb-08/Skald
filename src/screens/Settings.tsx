import { useState, useEffect } from 'react';
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
  LibraryManagementSection,
  DownloadsSection,
  AppearanceSection,
  KeyboardSection,
  AboutSection,
  NotificationsSection,
  BackupSection,
  ScheduledTasksSection,
  LogsSection,
  SharingSection,
} from '../components/settings';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface SettingsProps { st: OnyxState; onLogout: () => void; }

type SectionId =
  | 'account' | 'server' | 'notifications' | 'backups' | 'scheduled-tasks' | 'logs' | 'sharing' | 'playback' | 'audio'
  | 'library' | 'downloads' | 'appearance' | 'keyboard' | 'about';

// `requiresAbs` marks panes that only make sense with an Audiobookshelf server
// connection — they're hidden in local-only mode. `adminOnly` panes are hidden
// from non-admin users. Both are filtered at render time but keep their slot.
interface NavSection { id: SectionId; label: string; icon: IconName; requiresAbs?: boolean; adminOnly?: boolean; }

// Sorted alphabetically by label. ABS-only entries (Server + the admin panes) are
// hidden when no server is connected; admin panes are also hidden from non-admins.
const NAV: NavSection[] = [
  { id: 'about',           label: 'About',           icon: 'dot'        },
  { id: 'account',         label: 'Account',         icon: 'home'       },
  { id: 'appearance',      label: 'Appearance',      icon: 'speaker'    },
  { id: 'audio',           label: 'Audio',           icon: 'headphones' },
  { id: 'backups',         label: 'Backups',         icon: 'bookmark',   requiresAbs: true, adminOnly: true },
  { id: 'downloads',       label: 'Downloads',       icon: 'bookmark'   },
  { id: 'keyboard',        label: 'Keyboard',        icon: 'kbd'        },
  { id: 'library',         label: 'Libraries',       icon: 'grid'       },
  { id: 'logs',            label: 'Logs',            icon: 'list',       requiresAbs: true, adminOnly: true },
  { id: 'notifications',   label: 'Notifications',   icon: 'airplay',    requiresAbs: true, adminOnly: true },
  { id: 'playback',        label: 'Playback',        icon: 'play'       },
  { id: 'scheduled-tasks', label: 'Scheduled Tasks', icon: 'sleep',      requiresAbs: true, adminOnly: true },
  { id: 'server',          label: 'Server',          icon: 'monitor',    requiresAbs: true },
  { id: 'sharing',         label: 'Sharing & RSS',   icon: 'airplay',    requiresAbs: true, adminOnly: true },
];

export default function Settings({ st, onLogout }: SettingsProps) {
  const [section, setSection] = useState<SectionId>('account');
  // True when connected to an Audiobookshelf server. Local-only users (no token)
  // never see the ABS-only panes. authToken is seeded synchronously from the
  // skald.hasAuth presence flag, so this is stable across reloads and survives
  // the server being temporarily offline (the keyring token persists).
  const hasAbs = !!st.authToken && !!st.serverUrl;

  // If the selected pane's nav entry becomes hidden (admin flag revoked, server
  // disconnected), fall back to Account rather than rendering a blank panel
  // whose nav item no longer exists.
  useEffect(() => {
    const nav = NAV.find(s => s.id === section);
    const hidden = !!nav && ((nav.requiresAbs && !hasAbs) || (nav.adminOnly && !st.isAdmin));
    if (hidden) setSection('account');
  }, [section, hasAbs, st.isAdmin]);

  async function handleSignOut() {
    try { await logout(); } catch { /* keyring failure is non-fatal */ }
    localStorage.removeItem('skald.hasAuth');
    localStorage.removeItem('skald.serverUrl');
    localStorage.removeItem('skald.userId');
    localStorage.removeItem('skald.username');
    localStorage.removeItem('skald.sessionId');
    // The persisted profile is tokenless, but a signed-out machine shouldn't
    // keep the previous account's identity around either.
    localStorage.removeItem('skald.user');
    // Also exit local-only mode so the auth gate shows the login screen again.
    st.setLocalMode(false);
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
        {/* Sidebar — scrolls vertically when the nav list is taller than the pane
            (low-resolution windows would otherwise spill the last items out). */}
        <Glass translucent={st.translucent} style={{ width: 260, padding: '20px 14px', display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0, overflowY: 'auto' }}>
          {NAV.map(s => {
            // Hide ABS-only panes in local-only mode (no server connected), and
            // hide admin-only panes from non-admins. Libraries stays visible for
            // everyone — it also hosts local libraries (always available); the
            // admin-only server-library pane inside it is gated within the section.
            if (s.requiresAbs && !hasAbs) return null;
            if (s.adminOnly && !st.isAdmin) return null;
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
          {section === 'logs'             && <LogsSection st={st} />}
          {section === 'sharing'          && <SharingSection st={st} />}
          {/* st is passed so the Sessions subtab can access serverUrl and user type */}
          {section === 'playback'   && <PlaybackSection st={st} />}
          {section === 'audio'      && <AudioSection />}
          {section === 'library'    && <LibraryManagementSection st={st} />}
          {section === 'downloads'  && <DownloadsSection st={st} />}
          {section === 'appearance' && <AppearanceSection st={st} />}
          {section === 'keyboard'      && <KeyboardSection />}
          {section === 'about'         && <AboutSection st={st} />}
        </Glass>
      </div>
    </div>
  );
}
