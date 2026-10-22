// A tiny transaction over the JSON collections in state/: load on first touch, write back
// only what changed, all under the folder lock.
import { openStore, resolveHome } from './store.js';
import { loadSettings, allPlatforms } from './config.js';
import { makeRng } from './rng.js';

const OBJECT_COLLECTIONS = new Set(['days', 'weights', 'meta', 'runs']);

export function tx(store, fn) {
  return store.withLock(() => {
    const loaded = {};
    const touch = (name) => {
      if (!(name in loaded)) {
        const v = store.read(name, OBJECT_COLLECTIONS.has(name) ? {} : []);
        loaded[name] = { v, before: JSON.stringify(v) };
      }
      return loaded[name];
    };
    const db = new Proxy({}, {
      get: (_, name) => (typeof name === 'string' ? touch(name).v : undefined),
      set: (_, name, val) => { touch(name).v = val; return true; },
    });
    const out = fn(db);
    if (out && typeof out.then === 'function') throw new Error('tx callbacks must be synchronous');
    for (const [name, { v, before }] of Object.entries(loaded)) if (JSON.stringify(v) !== before) store.write(name, v);
    return out;
  });
}

// The context every tool handler receives.
export function makeContext({ home = resolveHome(), now = () => Date.now(), seed, fetchImpl } = {}) {
  const store = openStore(home);
  store.ensure();
  const rng = makeRng(seed ?? Date.now());
  return {
    store, rng, now, fetchImpl,
    settings: () => loadSettings(store),
    platforms: allPlatforms,
    tx: (fn) => tx(store, fn),
    id: (kind) => store.nextId(kind),
    iso: () => new Date(now()).toISOString(),
  };
}

export const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
