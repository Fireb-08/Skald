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
