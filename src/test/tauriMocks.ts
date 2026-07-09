// Shared Tauri mocks for Vitest (Testing Suite plan, Phase 1).
//
// Usage inside a test file (vi.mock factories are hoisted, so route them
// through vi.hoisted state):
//
//   const tauri = vi.hoisted(() => createTauriMockState());
//   vi.mock('@tauri-apps/api/core',  () => ({ invoke: tauri.invoke }));
//   vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }));
//
// Commands default to resolving `undefined`; register per-command handlers
// with tauri.onCommand(name, fn). Events registered through the mocked
// `listen` can be fired with tauri.emit(event, payload); unlisten functions
// remove the handler, so lifecycle tests can count active listeners.

export interface TauriMockState {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  listen: (event: string, cb: (e: { event: string; payload: unknown }) => void) => Promise<() => void>;
  onCommand: (cmd: string, fn: (args?: Record<string, unknown>) => unknown) => void;
  calls: Array<{ cmd: string; args?: Record<string, unknown> }>;
  emit: (event: string, payload?: unknown) => void;
  listenerCount: (event: string) => number;
  reset: () => void;
}

export function createTauriMockState(): TauriMockState {
  const handlers = new Map<string, (args?: Record<string, unknown>) => unknown>();
  const listeners = new Map<string, Set<(e: { event: string; payload: unknown }) => void>>();
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];

  return {
    calls,
    invoke: async (cmd, args) => {
      calls.push({ cmd, args });
      const fn = handlers.get(cmd);
      return fn ? fn(args) : undefined;
    },
    listen: (event, cb) => {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(cb);
      return Promise.resolve(() => { set!.delete(cb); });
    },
    onCommand: (cmd, fn) => { handlers.set(cmd, fn); },
    emit: (event, payload) => {
      listeners.get(event)?.forEach(cb => cb({ event, payload }));
    },
    listenerCount: (event) => listeners.get(event)?.size ?? 0,
    reset: () => { handlers.clear(); listeners.clear(); calls.length = 0; },
  };
}
