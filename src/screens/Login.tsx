// Saga login screen — a split-panel sign-in window matching the design reference.
// Left: editorial "manuscript" panel with wash background and display serif text.
// Right: quiet underline-only form fields with entrance animation.
import { useState, useRef, useEffect } from 'react';
import type { OnyxState } from '../state/onyx';
import { login, saveToken } from '../api/abs';
import Titlebar from '../components/chrome/Titlebar';

// Typography constants matching the Saga design tokens
const SERIF = '"Source Serif 4", "Source Serif Pro", Georgia, serif';
const MONO  = "'JetBrains Mono', ui-monospace, monospace";
const SANS  = "'Inter', system-ui, -apple-system, sans-serif";

export interface LoginProps {
  // The global app state — needed to persist token and navigate after login
  st: OnyxState;
}

export default function Login({ st }: LoginProps) {
  // ── Form state (local only — never touches global state until submit succeeds) ──
  const [scheme, setScheme] = useState<'http' | 'https'>('http');     // protocol selector
  const [host, setHost]     = useState('192.168.1.238:13378');         // host:port pre-filled
  const [user, setUser]     = useState('Testadmin');                    // username pre-filled
  const [pass, setPass]     = useState('');                             // password starts empty
  const [schemeOpen, setSchemeOpen] = useState(false);                  // dropdown open state
  const [pending, setPending] = useState(false);                        // request in flight
  const [error, setError]   = useState('');                             // validation/server error

  // Ref for the scheme dropdown wrapper — used to detect outside-click dismissal
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close the scheme dropdown when the user clicks anywhere outside it
  useEffect(() => {
    if (!schemeOpen) return;
    const onDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSchemeOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [schemeOpen]);

  // ── Submit handler ──────────────────────────────────────────────────────────
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate in order per the README — show the first failing error only
    if (!host.trim()) return setError('A server address is required.');
    if (!user.trim()) return setError('Your name is required.');
    if (!pass)        return setError('A passphrase is required.');
    setError('');
    setPending(true);
    try {
      const serverUrl = `${scheme}://${host.trim()}`;
      // Call the existing Tauri login command; throws on authentication failure
      const result = await login(serverUrl, user.trim(), pass);
      // Persist the token to the OS keyring via the Rust save_token command
      await saveToken(result.token);
      // Write all auth/server state into global OnyxState so App.tsx gate opens
      st.setAuthToken(result.token);
      st.setServerUrl(serverUrl);
      st.setUserId(result.id);
      st.setUsername(result.username);
      st.setUser(result);
      // Navigate into the library — the auth gate in App.tsx will also flip
      st.setScreen('library');
    } catch (err) {
      // Show the server error message if available; fall back to a friendly string
      setError(
        typeof err === 'string'
          ? err
          : (err as Error)?.message ?? 'Could not connect. Check your address and credentials.',
      );
      setPending(false);
    }
  };

  // Shared underline-only input style — all three fields share this base
  const underline: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    background: 'transparent',
    border: 'none',
    // Bottom border only — the "underline" affordance from the spec
    borderBottom: '1px solid rgba(255,255,255,0.12)',
    outline: 'none',
    color: '#ebe7df',
    fontSize: 16,
    fontFamily: SERIF,
    padding: '0 0 9px',
    letterSpacing: '0.01em',
  };

  return (
    // Full-screen backdrop behind the floating login window
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#08080b', // deep background visible around the window corners
    }}>
      {/* ── Login window — 760×620 with rounded corners and ambient shadow ── */}
      <div style={{
        position: 'relative',
        width: 760,
        height: 620,
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 30px 70px rgba(0,0,0,0.5)',
        display: 'flex',
        overflow: 'hidden',
        background: '#0b0b0e',
        color: '#ebe7df',
        fontFamily: SANS,
      }}>
        {/* Titlebar: absolutely positioned, spans the full 760px width at z-index 50 */}
        <Titlebar isDark subtitle="Saga" />

        {/* ── LEFT PANEL — 268px manuscript column ───────────────────────── */}
        <div style={{
          position: 'relative',
          width: 268,
          flexShrink: 0,
          overflow: 'hidden',
          // Gold rule separating the two columns
          borderRight: '1px solid rgba(212,166,74,0.35)',
        }}>
          {/* Wash background at 1.4× intensity (inline because OnyxWash has no intensity prop).
              Values: standard glow ×1.4 — 0.14→0.196, 0.08→0.112. */}
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#0b0b0e', pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: '-15%', top: '-25%', width: '70%', height: '120%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(212,166,74,0.196), transparent 65%)', filter: 'blur(90px)' }} />
            <div style={{ position: 'absolute', right: '-10%', top: '20%', width: '60%', height: '80%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(212,166,74,0.112), transparent 60%)', filter: 'blur(110px)' }} />
            <div style={{ position: 'absolute', left: '20%', bottom: '-30%', width: '70%', height: '90%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(60,40,20,0.6), transparent 65%)', filter: 'blur(120px)' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.55))' }} />
            {/* Subtle grain overlay */}
            <div style={{ position: 'absolute', inset: 0, opacity: 0.05, mixBlendMode: 'overlay', backgroundImage: 'repeating-radial-gradient(circle at 13% 27%, rgba(255,255,255,0.6) 0 0.5px, transparent 0.5px 3px), repeating-radial-gradient(circle at 73% 67%, rgba(255,255,255,0.5) 0 0.5px, transparent 0.5px 3px)' }} />
          </div>
          {/* Extra gold radial overlay from top-left corner (soft-light blend) */}
          <div style={{ position: 'absolute', inset: 0, opacity: 0.5, mixBlendMode: 'soft-light', pointerEvents: 'none', background: 'radial-gradient(120% 80% at 0% 0%, rgba(212,166,74,0.35), transparent 55%)' }} />

          {/* Panel content: top block pinned to top, quote pinned to bottom */}
          <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '54px 30px 30px' }}>
            {/* Top block: eyebrow → gold rule → display heading */}
            <div>
              {/* "Skald" eyebrow in mono */}
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', color: '#d4a64a' }}>
                Skald
              </div>
              {/* 26×1px gold rule */}
              <div style={{ width: 26, height: 1, background: 'rgba(212,166,74,0.35)', margin: '16px 0 18px' }} />
              {/* Display heading — 33px/600 serif, "hall" in italic accent gold */}
              <div style={{ fontFamily: SERIF, fontSize: 33, lineHeight: 1.14, fontWeight: 600, letterSpacing: '-0.015em', color: '#ebe7df' }}>
                The teller<br />returns to<br />the{' '}
                <span style={{ fontStyle: 'italic', color: '#d4a64a' }}>hall</span>.
              </div>
            </div>

            {/* Bottom quote block — italic serif, 13px, maxWidth 200px */}
            <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, lineHeight: 1.55, color: 'rgba(235,231,223,0.62)', maxWidth: 200 }}>
              "Every tale you keep awaits you here — bound, voiced, and ready to resume."
              {/* Attribution line — NOT italic, mono, very muted */}
              <div style={{ fontStyle: 'normal', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(235,231,223,0.38)', marginTop: 14 }}>
                — the keeper's note
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL — form, with saga-in entrance animation ─────────── */}
        <form
          onSubmit={submit}
          className="saga-in" // triggers the slide-in keyframe defined in index.css
          style={{
            position: 'relative',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '54px 44px 40px',
            zIndex: 10, // sits above the wash layers
          }}
        >
          {/* Header: title + subtitle */}
          <div style={{ marginBottom: 30 }}>
            <div style={{ fontFamily: SERIF, fontSize: 27, fontWeight: 600, letterSpacing: '-0.01em', color: '#ebe7df' }}>
              Enter the hall
            </div>
            <div style={{ fontSize: 13, fontFamily: SANS, color: 'rgba(235,231,223,0.62)', marginTop: 6 }}>
              Connect to your library server to continue.
            </div>
          </div>

          {/* Fields — 24px gap between each */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* ── Field 1: Server URL (scheme dropdown + host input) ── */}
            <label style={{ display: 'block' }}>
              {/* Italic serif label above the field */}
              <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: 'rgba(235,231,223,0.62)', marginBottom: 7 }}>
                Where is your server?
              </div>
              {/* Flex row: scheme dropdown on the left, host input on the right */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>

                {/* Custom scheme dropdown: trigger button + absolute menu */}
                <div ref={dropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
                  {/* Trigger button — shows "{scheme}://" with rotating caret */}
                  <button
                    type="button"
                    onClick={() => setSchemeOpen(o => !o)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid rgba(255,255,255,0.12)',
                      color: '#d4a64a', // accent gold for the scheme text
                      fontFamily: SERIF,
                      fontSize: 16,
                      padding: '0 4px 9px 0',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {scheme}://
                    {/* Caret rotates 180° when the menu is open */}
                    <span style={{
                      fontSize: 10,
                      color: 'rgba(235,231,223,0.38)',
                      display: 'inline-block',
                      transform: schemeOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.15s',
                    }}>▾</span>
                  </button>

                  {/* Dropdown menu — only rendered when open */}
                  {schemeOpen && (
                    <div style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      left: 0,
                      background: '#1a1a22', // panel-2 from design tokens
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 8,
                      boxShadow: '0 16px 32px rgba(0,0,0,0.5)',
                      padding: 5,
                      zIndex: 30,
                      minWidth: 132,
                    }}>
                      {/* https listed first (TLS preferred), http second (PLAIN) */}
                      {(['https', 'http'] as const).map(s => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => { setScheme(s); setSchemeOpen(false); }}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 12,
                            width: '100%',
                            textAlign: 'left',
                            // Highlight the currently-selected scheme
                            background: s === scheme ? 'rgba(212,166,74,0.18)' : 'transparent',
                            border: 'none',
                            borderRadius: 5,
                            padding: '8px 10px',
                            cursor: 'pointer',
                            fontFamily: SERIF,
                            fontSize: 14,
                            color: s === scheme ? '#d4a64a' : '#ebe7df',
                          }}
                        >
                          {s}://
                          {/* Right-side tag: TLS or PLAIN */}
                          <span style={{ fontFamily: MONO, fontSize: 9, color: 'rgba(235,231,223,0.38)', letterSpacing: '0.06em' }}>
                            {s === 'http' ? 'PLAIN' : 'TLS'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Host input — takes remaining width */}
                <input
                  className="saga-input" // focus rule in index.css
                  style={{ ...underline, flex: 1 }}
                  value={host}
                  onChange={e => setHost(e.target.value)}
                  placeholder="192.168.1.238:13378"
                  spellCheck={false}
                />
              </div>
            </label>

            {/* ── Field 2: Username ── */}
            <label style={{ display: 'block' }}>
              <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: 'rgba(235,231,223,0.62)', marginBottom: 7 }}>
                By what name are you known?
              </div>
              <input
                className="saga-input"
                style={underline}
                value={user}
                onChange={e => setUser(e.target.value)}
                placeholder="username"
                spellCheck={false}
              />
            </label>

            {/* ── Field 3: Password ── */}
            <label style={{ display: 'block' }}>
              <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: 'rgba(235,231,223,0.62)', marginBottom: 7 }}>
                Your passphrase
              </div>
              <input
                className="saga-input"
                style={underline}
                type="password"
                value={pass}
                onChange={e => setPass(e.target.value)}
                placeholder="••••••••••"
              />
            </label>
          </div>

          {/* Validation / connection error — italic serif, danger color */}
          {error && (
            <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: '#f1a89a', marginTop: 18 }}>
              {error}
            </div>
          )}

          {/* Action row: gold pill CTA + forgotten-passphrase link */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 32 }}>
            {/* Primary "Enter" button — gold pill with gradient */}
            <button
              type="submit"
              disabled={pending}
              className="saga-cta" // hover/active rules in index.css
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                // Three-stop gold gradient matching the spec
                background: 'linear-gradient(180deg, #e9bb5e, #d4a64a 55%, #a37d2e)',
                border: '1px solid rgba(212,166,74,0.35)',
                borderRadius: 999, // pill shape
                color: '#1a1306', // near-black text on gold
                fontFamily: SERIF,
                fontWeight: 600,
                fontSize: 15,
                padding: '11px 28px',
                cursor: pending ? 'wait' : 'pointer',
                letterSpacing: '0.01em',
                boxShadow: '0 8px 24px rgba(212,166,74,0.22), inset 0 1px 0 rgba(255,255,255,0.2)',
                transition: 'transform 0.12s, box-shadow 0.18s, filter 0.12s',
              }}
            >
              {/* Button label — "Opening…" while request is in flight */}
              {pending ? 'Opening…' : 'Enter'}
              {/* Arrow slides right on CTA hover (via .saga-arrow rule in index.css) */}
              <span className="saga-arrow" style={{ display: 'flex', transition: 'transform 0.2s' }}>→</span>
            </button>

            {/* Secondary link — no real action in MVP */}
            <a
              href="#"
              onClick={e => e.preventDefault()}
              style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: 'rgba(235,231,223,0.62)', textDecoration: 'none' }}
            >
              I've forgotten my passphrase
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
