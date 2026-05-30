import { useState } from 'react';
import { login, saveToken } from '../api/abs';
import type { OnyxState } from '../state/onyx';
import OnyxWash from '../components/chrome/OnyxWash';
import Titlebar from '../components/chrome/Titlebar';

export interface LoginProps {
  st: OnyxState;
}

export default function Login({ st }: LoginProps) {
  const isDark = st.theme !== 'light';
  const z = st.scale / 100;
  const mono = "'JetBrains Mono', ui-monospace, monospace";
  const serif = "'Source Serif 4', 'Georgia', serif";

  const [serverUrl, setServerUrl] = useState(st.serverUrl || '');
  const [username, setUsername] = useState(st.username || '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleConnect() {
    if (!serverUrl.trim() || !username.trim() || !password.trim()) {
      setError('All fields are required.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const user = await login(serverUrl.trim(), username.trim(), password);
      await saveToken(user.token);
      st.setServerUrl(serverUrl.trim());
      st.setUserId(user.id);
      st.setAuthToken(user.token);
      st.setUsername(user.username);
      st.setUser(user);
    } catch (e) {
      setError(
        typeof e === 'string'
          ? e
          : e instanceof Error
            ? e.message
            : 'Login failed. Check your server URL and credentials.',
      );
    } finally {
      setLoading(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleConnect();
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    fontSize: 13.5,
    background: 'rgba(0,0,0,0.35)',
    borderRadius: 8,
    color: 'var(--onyx-text)',
    border: '1px solid var(--onyx-glass-edge)',
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10,
    color: 'var(--onyx-text-mute)',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    marginBottom: 5,
    display: 'block',
  };

  return (
    <div style={{
      position: 'relative',
      width: `${100 / z}vw`,
      height: `${100 / z}vh`,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transform: `scale(${z})`,
      transformOrigin: 'top left',
    }}>
      <OnyxWash isDark={isDark} />
      <Titlebar isDark={isDark} />

      {/* Content area below titlebar */}
      <div style={{
        position: 'absolute',
        top: 44,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {/* Login card */}
        <div style={{
          width: 400,
          background: 'var(--onyx-glass-strong)',
          backdropFilter: 'blur(40px) saturate(120%)',
          WebkitBackdropFilter: 'blur(40px) saturate(120%)',
          border: '1px solid var(--onyx-glass-edge)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
          padding: '36px 32px 32px',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 12, marginBottom: 14,
              background: 'var(--onyx-glass-strong)',
              border: '1px solid var(--onyx-glass-edge)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--onyx-accent)',
              fontFamily: serif, fontSize: 28, fontWeight: 600,
            }}>S</div>
            <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 500, color: 'var(--onyx-text)', letterSpacing: '-0.01em' }}>
              Skald<span style={{ color: 'var(--onyx-accent)' }}>.</span>
            </div>
            <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 6 }}>
              Connect to your server
            </div>
          </div>

          {/* Form fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
            <div>
              <label style={labelStyle}>Server URL</label>
              <input
                type="text"
                value={serverUrl}
                onChange={e => setServerUrl(e.target.value)}
                placeholder="http://your-server:13378"
                style={{ ...inputStyle, fontFamily: mono, fontSize: 12.5 }}
                onKeyDown={onKey}
                disabled={loading}
              />
            </div>
            <div>
              <label style={labelStyle}>Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder=""
                style={inputStyle}
                onKeyDown={onKey}
                disabled={loading}
              />
            </div>
            <div>
              <label style={labelStyle}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder=""
                style={inputStyle}
                onKeyDown={onKey}
                disabled={loading}
              />
            </div>
          </div>

          {/* Connect button */}
          <button
            onClick={handleConnect}
            disabled={loading}
            style={{
              width: '100%',
              padding: '11px 0',
              background: loading ? 'var(--onyx-accent-dim)' : 'var(--onyx-accent)',
              border: '1px solid var(--onyx-accent-edge)',
              borderRadius: 8,
              color: loading ? 'var(--onyx-text-mute)' : '#0b0b0e',
              fontFamily: mono,
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: loading ? 'default' : 'pointer',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {loading ? 'Connecting…' : 'Connect'}
          </button>

          {/* Error message */}
          {error && (
            <div style={{
              marginTop: 12,
              padding: '10px 12px',
              background: 'rgba(232,113,106,0.12)',
              border: '1px solid rgba(232,113,106,0.3)',
              borderRadius: 7,
              color: '#e8716a',
              fontSize: 12.5,
              lineHeight: 1.45,
            }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
