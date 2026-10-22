// A tiny transaction over the JSON collections in state/: load on first touch, write back
// only what changed, all under the folder lock.
import { openStore, resolveHome } from './store.js';
import { openPersonas } from './personas.js';
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

// The context every tool handler receives. `home` is the studio folder; each persona's data
// lives in its own folder under it. The root context follows the active persona;
// ctx.persona(slug) is a context pinned to one persona (tool calls get one of these).
export function makeContext({ home = resolveHome(), now = () => Date.now(), seed, fetchImpl } = {}) {
  const personas = openPersonas(home);
  const rng = makeRng(seed ?? Date.now());
  const pinned = new Map();
  const shared = { rng, now, fetchImpl, root: personas.root, personas, platforms: allPlatforms, iso: () => new Date(now()).toISOString() };
  function persona(slug) {
    if (!pinned.has(slug)) {
      const store = openStore(personas.dir(slug));
      store.ensure();
      pinned.set(slug, {
        ...shared, slug, store, persona,
        settings: () => loadSettings(store),
        tx: (fn) => tx(store, fn),
        id: (kind) => store.nextId(kind),
      });
    }
    return pinned.get(slug);
  }
  const current = () => persona(personas.active());
  current();
  return {
    ...shared, persona, current,
    get slug() { return current().slug; },
    get store() { return current().store; },
    settings: () => current().settings(),
    tx: (fn) => current().tx(fn),
    id: (kind) => current().id(kind),
  };
}

export const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
