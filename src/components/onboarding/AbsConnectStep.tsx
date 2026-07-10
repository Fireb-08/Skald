// Step 3a — Connect to Audiobookshelf. Ports Login.tsx's API-key/password form
// into the onboarding step, sharing the same underlying login / loginWithApiKey /
// saveToken calls (no duplicated auth logic). On success it writes token / server
// / user into OnyxState exactly as Login does, then advances.
// (First-Launch Onboarding, Phase 2.)
import { useState, useRef, useEffect } from 'react';
import type { OnyxState } from '../../state/onyx';
import { login, saveToken, loginWithApiKey } from '../../api/abs';
import { log } from '../../lib/log';
import { GoldButton, SERIF, MONO, SANS } from './frame';

export interface AbsConnectStepProps {
  st: OnyxState;
  // Called after the token/server/user are persisted into OnyxState.
  onConnected: () => void;
}

export default function AbsConnectStep({ st, onConnected }: AbsConnectStepProps) {
  const lastServer = (() => {
    try { return new URL(localStorage.getItem('skald.lastServerUrl') ?? ''); } catch { return null; }
  })();
  const [scheme, setScheme] = useState<'http' | 'https'>(() => lastServer?.protocol === 'https:' ? 'https' : 'http');
  const [host, setHost]     = useState(() => lastServer?.host ?? '');
  const [user, setUser]     = useState('');
  const [pass, setPass]     = useState('');
  const [schemeOpen, setSchemeOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError]   = useState('');
  const [method, setMethod] = useState<'password' | 'apikey'>('apikey');
  const [apiKey, setApiKey] = useState('');

  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!schemeOpen) return;
    const onDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setSchemeOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [schemeOpen]);

  // Same two-method submit as Login.tsx — the only difference is that success
  // calls onConnected() (advance the step) instead of setScreen('library').
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!host.trim()) return setError('A server address is required.');
    const serverUrl = `${scheme}://${host.trim()}`;

    if (method === 'apikey') {
      if (!apiKey.trim()) return setError('An API key is required.');
      setError(''); setPending(true);
      try {
        const result = await loginWithApiKey(serverUrl, apiKey.trim());
        await saveToken(result.token);
        localStorage.setItem('skald.lastServerUrl', serverUrl);
        st.setAuthToken(result.token);
        st.setServerUrl(serverUrl);
        st.setUserId(result.user.id);
        st.setUsername(result.user.username);
        st.setUser(result.user);
        if (result.serverSettings) st.setServerSettings(result.serverSettings);
        log.info('app', 'onboarding abs connected', { method: 'apikey' });
        onConnected();
      } catch (err) {
        setError(typeof err === 'string' ? err : (err as Error)?.message ?? 'Could not connect. Check your address and API key.');
        setPending(false);
      }
      return;
    }

    if (!user.trim()) return setError('A username is required.');
    if (!pass)        return setError('A password is required.');
    setError(''); setPending(true);
    try {
      const { user: loggedInUser, serverSettings } = await login(serverUrl, user.trim(), pass);
      if (serverSettings) st.setServerSettings(serverSettings);
      await saveToken(loggedInUser.token);
      localStorage.setItem('skald.lastServerUrl', serverUrl);
      st.setAuthToken(loggedInUser.token);
      st.setServerUrl(serverUrl);
      st.setUserId(loggedInUser.id);
      st.setUsername(loggedInUser.username);
      st.setUser(loggedInUser);
      log.info('app', 'onboarding abs connected', { method: 'password' });
      onConnected();
    } catch (err) {
      setError(typeof err === 'string' ? err : (err as Error)?.message ?? 'Could not connect. Check your address and credentials.');
      setPending(false);
    }
  };

  const underline: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.12)', outline: 'none', color: '#ebe7df',
    fontSize: 16, fontFamily: SERIF, padding: '0 0 9px', letterSpacing: '0.01em',
  };

  // Already connected (e.g. user clicked Back then Continue) — show a confirmation
  // rather than forcing a re-login.
  if (st.authToken) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12,
          background: 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.08)',
          border: '1px solid rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.25)',
        }}>
          <span style={{ color: 'var(--onyx-accent)', fontSize: 18 }}>✓</span>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 15, color: '#ebe7df' }}>Connected to your server</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'rgba(235,231,223,0.5)', marginTop: 2 }}>{st.serverUrl}</div>
          </div>
        </div>
        <div><GoldButton onClick={onConnected}>Continue</GoldButton></div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Method toggle — API Key (primary) / Password */}
      <div style={{ display: 'flex', marginBottom: 22 }}>
        <div style={{ display: 'flex', borderRadius: 999, border: '1px solid rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.25)', overflow: 'hidden' }}>
          {(['apikey', 'password'] as const).map(m => (
            <button
              key={m} type="button" onClick={() => { setMethod(m); setError(''); }}
              style={{
                background: method === m ? 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.15)' : 'transparent',
                border: 'none', color: method === m ? 'var(--onyx-accent)' : 'rgba(235,231,223,0.38)',
                fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                padding: '5px 16px', cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
              }}
            >{m === 'password' ? 'Password' : 'API Key'}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* Server URL */}
        <label style={{ display: 'block' }}>
          <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: 'rgba(235,231,223,0.62)', marginBottom: 7 }}>Where is your server?</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <div ref={dropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button type="button" onClick={() => setSchemeOpen(o => !o)} style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.12)', color: 'var(--onyx-accent)', fontFamily: SERIF, fontSize: 16, padding: '0 4px 9px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                {scheme}://
                <span style={{ fontSize: 10, color: 'rgba(235,231,223,0.38)', display: 'inline-block', transform: schemeOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
              </button>
              {schemeOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, background: '#1a1a22', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, boxShadow: '0 16px 32px rgba(0,0,0,0.5)', padding: 5, zIndex: 30, minWidth: 132 }}>
                  {(['https', 'http'] as const).map(s => (
                    <button key={s} type="button" onClick={() => { setScheme(s); setSchemeOpen(false); }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', background: s === scheme ? 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.18)' : 'transparent', border: 'none', borderRadius: 5, padding: '8px 10px', cursor: 'pointer', fontFamily: SERIF, fontSize: 14, color: s === scheme ? 'var(--onyx-accent)' : '#ebe7df' }}>
                      {s}://
                      <span style={{ fontFamily: MONO, fontSize: 9, color: 'rgba(235,231,223,0.38)', letterSpacing: '0.06em' }}>{s === 'http' ? 'PLAIN' : 'TLS'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input className="saga-input" style={{ ...underline, flex: 1 }} value={host} onChange={e => setHost(e.target.value)} placeholder="library.example.com" spellCheck={false} />
          </div>
        </label>

        {method === 'password' ? (
          <>
            <label style={{ display: 'block' }}>
              <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: 'rgba(235,231,223,0.62)', marginBottom: 7 }}>Username</div>
              <input className="saga-input" style={underline} value={user} onChange={e => setUser(e.target.value)} placeholder="Username" spellCheck={false} />
            </label>
            <label style={{ display: 'block' }}>
              <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: 'rgba(235,231,223,0.62)', marginBottom: 7 }}>Password</div>
              <input className="saga-input" style={underline} type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="••••••••••" />
            </label>
          </>
        ) : (
          <label style={{ display: 'block' }}>
            <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: 'rgba(235,231,223,0.62)', marginBottom: 7 }}>Your API key</div>
            <textarea className="saga-input" rows={3} style={{ ...underline, fontFamily: MONO, fontSize: 11, letterSpacing: '0.03em', resize: 'none', lineHeight: 1.6, paddingTop: 4 }} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste your API key here" spellCheck={false} autoComplete="off" />
            <div style={{ fontFamily: SANS, fontSize: 11, color: 'rgba(235,231,223,0.35)', marginTop: 8 }}>Generate a key in Settings → Users → API Keys on your server.</div>
          </label>
        )}
      </div>

      {error && (
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: '#f1a89a', marginTop: 18 }}>{error}</div>
      )}

      <div style={{ marginTop: 28 }}>
        <GoldButton type="submit" busy={pending}>{pending ? 'Connecting…' : 'Connect'}</GoldButton>
      </div>
    </form>
  );
}
