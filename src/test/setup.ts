import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node 26 exposes a configurable global `localStorage` accessor whose value is
// undefined unless the process receives --localstorage-file. It also shadows
// jsdom's implementation in Vitest, so provide the same in-memory Storage
// semantics the tests received from jsdom on earlier Node releases.
const entries = new Map<string, string>();
const storage: Storage = {
  get length() {
    return entries.size;
  },
  clear() {
    entries.clear();
  },
  getItem(key) {
    return entries.get(String(key)) ?? null;
  },
  key(index) {
    return [...entries.keys()][index] ?? null;
  },
  removeItem(key) {
    entries.delete(String(key));
  },
  setItem(key, value) {
    entries.set(String(key), String(value));
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
});

// Unmount rendered components and hooks between tests.
//
// Testing Library registers this itself, but only when `afterEach` is a global
// — and this project runs Vitest without `globals: true`, so it silently never
// did. Rendered hooks therefore survived their test: `useOnyxState` attaches a
// window keydown listener, so a leaked instance keeps handling key events in
// later tests and answers with *its* stale state. That is a test lying about
// the code, which is worse than no test.
afterEach(cleanup);
