import '@testing-library/jest-dom/vitest';

// Node 26 объявляет свой глобальный localStorage (без файла хранилища он
// undefined), и jsdom его не перекрывает. Для тестов — простое хранилище в памяти.
if (typeof window !== 'undefined' && !window.localStorage) {
  const mem = new Map<string, string>();
  const storage: Storage = {
    get length() { return mem.size; },
    clear: () => mem.clear(),
    getItem: k => (mem.has(k) ? mem.get(k)! : null),
    key: i => Array.from(mem.keys())[i] ?? null,
    removeItem: k => { mem.delete(k); },
    setItem: (k, v) => { mem.set(k, String(v)); }
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}
