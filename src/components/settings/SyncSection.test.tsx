import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: { event: string; payload: unknown }) => void>>();
  return {
    listen: (event: string, cb: (event: { event: string; payload: unknown }) => void) => {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(cb);
      return Promise.resolve(() => { set!.delete(cb); });
    },
    emit: (event: string, payload?: unknown) => listeners.get(event)?.forEach(cb => cb({ event, payload })),
    reset: () => listeners.clear(),
  };
});

const socket = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  disconnect: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }));
vi.mock('../../api/abs', () => ({ connectSocket: socket.connect, disconnectSocket: socket.disconnect }));
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));

import SyncSection from './SyncSection';
import type { OnyxState } from '../../state/onyx';

const setToast = vi.fn();

function Harness() {
  const [enabled, setEnabled] = useState(false);
  const st = {
    serverUrl: 'http://abs.local',
    authToken: '__keyring__',
    liveSyncEnabled: enabled,
    setLiveSyncEnabled: setEnabled,
    setToast,
  } as unknown as OnyxState;
  return (
    <>
      <output data-testid="enabled">{String(enabled)}</output>
      <SyncSection st={st} embedded />
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  tauri.reset();
  socket.connect.mockReset();
  socket.disconnect.mockClear();
  setToast.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SyncSection connection confirmation', () => {
  it('does not arm a stale timeout when authentication arrives before connect resolves', async () => {
    let resolveConnect: (() => void) | undefined;
    socket.connect.mockImplementation(() => new Promise<void>(resolve => { resolveConnect = resolve; }));

    render(<Harness />);
    await act(async () => {}); // settle async Tauri listener registration

    fireEvent.click(screen.getByRole('button'));
    expect(socket.connect).toHaveBeenCalledWith('http://abs.local');
    expect(screen.getByTestId('enabled').textContent).toBe('true');

    // Rust can emit this from inside connect_socket before the invoke promise
    // resolves back to JavaScript. It must clear an already-armed timer.
    act(() => { tauri.emit('socket-authenticated'); });
    expect(screen.getByText('Connected')).toBeTruthy();

    await act(async () => {
      resolveConnect?.();
      await Promise.resolve();
    });
    act(() => { vi.advanceTimersByTime(10_001); });

    expect(screen.getByTestId('enabled').textContent).toBe('true');
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(setToast).not.toHaveBeenCalled();
  });
});
