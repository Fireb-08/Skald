import { useState, useEffect } from 'react';
import type { OnyxState } from '../state/onyx';
import { logout } from '../api/abs';
import Glass from '../components/chrome/Glass';
import Icon from '../components/Icon';
import type { IconName } from '../components/Icon';
import { matchesSettingsSearch } from '../lib/settingsSearch';
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
interface NavSection { id: SectionId; label: string; icon: IconName; keywords: string[]; requiresAbs?: boolean; adminOnly?: boolean; }

interface NavGroup { label: string; sections: NavSection[]; }

// Group by the intent that brought the user to Settings. A whole group vanishes
// when all of its sections are permission/source gated, keeping local-only mode
// concise without maintaining a second navigation model.
const NAV_GROUPS: NavGroup[] = [
  { label: 'This device', sections: [
    { id: 'account', label: 'Account', icon: 'home', keywords: ['profile', 'password', 'user', 'sign out'] },
    { id: 'appearance', label: 'Appearance', icon: 'sliders', keywords: ['theme', 'accent', 'scale', 'cover size', 'layout', 'display', 'shelf'] },
    { id: 'audio', label: 'Audio', icon: 'headphones', keywords: ['device', 'output', 'equalizer', 'eq', 'volume'] },
    { id: 'downloads', label: 'Downloads', icon: 'download', keywords: ['offline', 'folder', 'storage', 'cache', 'retry'] },
    { id: 'keyboard', label: 'Keyboard', icon: 'kbd', keywords: ['shortcut', 'hotkey', 'keys'] },
  ]},
  { label: 'Libraries', sections: [
    { id: 'library', label: 'Libraries', icon: 'grid', keywords: ['local', 'staging', 'import', 'scan', 'provider', 'open library'] },
    { id: 'playback', label: 'Playback', icon: 'play', keywords: ['sleep timer', 'skip', 'speed', 'session', 'progress', 'resume'] },
  ]},
  { label: 'Audiobookshelf server', sections: [
    { id: 'server', label: 'Server', icon: 'monitor', keywords: ['sync', 'socket', 'connection', 'address'], requiresAbs: true },
    { id: 'logs', label: 'Logs', icon: 'list', keywords: ['diagnostic', 'errors', 'debug', 'report'], requiresAbs: true, adminOnly: true },
    { id: 'backups', label: 'Backups', icon: 'file', keywords: ['restore', 'schedule', 'database'], requiresAbs: true, adminOnly: true },
    { id: 'notifications', label: 'Notifications', icon: 'bell', keywords: ['apprise', 'alerts', 'events'], requiresAbs: true, adminOnly: true },
    { id: 'scheduled-tasks', label: 'Scheduled Tasks', icon: 'clock', keywords: ['jobs', 'scanner', 'maintenance'], requiresAbs: true, adminOnly: true },
    { id: 'sharing', label: 'Sharing & RSS', icon: 'share', keywords: ['feeds', 'public link', 'opds'], requiresAbs: true, adminOnly: true },
  ]},
  { label: 'About', sections: [
    { id: 'about', label: 'About', icon: 'info', keywords: ['help', 'quick start', 'version', 'privacy', 'troubleshooting'] },
  ]},
];

const NAV = NAV_GROUPS.flatMap(group => group.sections);

function sectionVisible(section: NavSection, hasAbs: boolean, isAdmin: boolean): boolean {
  return !(section.requiresAbs && !hasAbs) && !(section.adminOnly && !isAdmin);
}

export default function Settings({ st, onLogout }: SettingsProps) {
  const requestedSection = NAV.some(item => item.id === st.settingsSection)
    ? st.settingsSection as SectionId
    : 'account';
  const [section, setSection] = useState<SectionId>(requestedSection);
  const [navQuery, setNavQuery] = useState('');
  // True when connected to an Audiobookshelf server. Local-only users (no token)
  // never see the ABS-only panes. authToken is seeded synchronously from the
  // skald.hasAuth presence flag, so this is stable across reloads and survives
  // the server being temporarily offline (the keyring token persists).
  const hasAbs = !!st.authToken && !!st.serverUrl;
  const visibleGroups = NAV_GROUPS
    .map(group => ({ ...group, sections: group.sections.filter(item => sectionVisible(item, hasAbs, st.isAdmin) && matchesSettingsSearch(item.label, item.id, item.keywords, navQuery)) }))
    .filter(group => group.sections.length > 0);

  // Shell CTAs can target a pane while Settings is already mounted. Keep this
  // reactive rather than treating the requested pane as initial state only.
  useEffect(() => {
    if (NAV.some(item => item.id === st.settingsSection)) {
      setSection(st.settingsSection as SectionId);
    }
  }, [st.settingsSection]);

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
    // Keep the non-secret address as a returning-user convenience. Credentials,
    // identity, session state, and the live connection are still fully cleared.
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
          <input
            value={navQuery}
            onChange={e => setNavQuery(e.target.value)}
            placeholder="Find a setting…"
            aria-label="Find a setting"
            style={{ margin: '0 8px 14px', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--onyx-glass-edge)', background: 'var(--onyx-glass)', color: 'var(--onyx-text)', fontFamily: 'inherit', fontSize: 12 }}
          />
          {visibleGroups.map((group, groupIndex) => (
            <div key={group.label} style={{ marginTop: groupIndex === 0 ? 0 : 14 }}>
              <div style={{ padding: '0 12px 6px', fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>
                {group.label}
              </div>
              {group.sections.map(s => {
                // Downloads keeps its at-a-glance stored-book count.
                const downloadCount = s.id === 'downloads' ? st.downloads.length : 0;
                const label = downloadCount > 0 ? `${s.label} (${downloadCount})` : s.label;
                return (
                  <button
                    key={s.id}
                    onClick={() => { setSection(s.id); st.setSettingsSection(s.id); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, width: '100%',
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
            </div>
          ))}

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
