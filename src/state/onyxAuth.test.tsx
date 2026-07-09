// Regression tests for auth-material persistence (Testing Suite plan #1/#2,
// keyring migration + skald.user token stripping). The migration runs at
// module load, so each test seeds localStorage first and then dynamically
// imports a FRESH copy of onyx.ts via vi.resetModules().
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const tauri = vi.hoisted(() => {
  const handlers = new Map<string, (args?: Record<string, unknown>) => unknown>();
  const listeners = new Map<string, Set<(e: { event: string; payload: unknown }) => void>>();
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  return {
    calls,
    handlers,
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return handlers.get(cmd)?.(args);
    },
    listen: (event: string, cb: (e: { event: string; payload: unknown }) => void) => {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(cb);
      return Promise.resolve(() => { set!.delete(cb); });
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }));
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));

// List-returning commands the state hook calls during mount — give them
// type-correct empty defaults so mount effects settle without noise.
function stubMountCommands() {
  tauri.handlers.set('get_downloads', () => []);
  tauri.handlers.set('get_local_libraries', () => []);
  tauri.handlers.set('load_library_cache', () => null);
}

async function freshOnyx() {
  vi.resetModules();
  return import('./onyx');
}

beforeEach(() => {
  localStorage.clear();
  tauri.calls.length = 0;
  tauri.handlers.clear();
  stubMountCommands();
});

describe('auth-material migration (module load)', () => {
  it('moves a legacy raw token to the keyring presence flag and scrubs it', async () => {
    localStorage.setItem('skald.authToken', 'legacy-raw-token');
    localStorage.setItem('skald.password', 'oops');

    await freshOnyx();

    expect(localStorage.getItem('skald.authToken')).toBeNull();
    expect(localStorage.getItem('skald.password')).toBeNull();
    expect(localStorage.getItem('skald.hasAuth')).toBe('true');
    // The keyring heal must receive the legacy token (via the save_token command).
    expect(tauri.calls.some(c => c.cmd === 'save_token')).toBe(true);
  });

  it('strips a token out of an already-persisted skald.user profile', async () => {
    localStorage.setItem('skald.user', JSON.stringify({
      id: 'u1', username: 'sam', token: 'raw-jwt-here', email: null, isActive: true,
    }));

    await freshOnyx();

    const stored = JSON.parse(localStorage.getItem('skald.user')!);
    expect(stored.token).toBe('');
    expect(stored.username).toBe('sam');
  });
});

describe('useOnyxState auth persistence', () => {
  it('setUser never persists or holds a token', async () => {
    const { useOnyxState } = await freshOnyx();
    const { result } = renderHook(() => useOnyxState(), {
      wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
    });
    await act(async () => {});

    await act(async () => {
      result.current.setUser({
        id: 'u1', username: 'sam', token: 'fresh-login-jwt', email: null, isActive: true,
      });
    });

    expect(result.current.user?.token).toBe('');
    const stored = JSON.parse(localStorage.getItem('skald.user')!);
    expect(stored.token).toBe('');
    expect(JSON.stringify(localStorage)).not.toContain('fresh-login-jwt');
  });

  it('startup with the presence flag exposes auth presence, not a raw token', async () => {
    localStorage.setItem('skald.hasAuth', 'true');
    const { useOnyxState } = await freshOnyx();
    const { result } = renderHook(() => useOnyxState(), {
      wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
    });
    await act(async () => {});

    expect(result.current.authToken).toBeTruthy();       // auth presence…
    expect(result.current.authToken).toBe('__keyring__'); // …as the sentinel, never a JWT
  });
});
