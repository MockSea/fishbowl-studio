// All state lives in one folder (STUDIO_HOME, default ~/Documents/Fishbowl Studio).
// Config files sit at its root where they can see them; bookkeeping lives in state/.
// Every write is atomic (temp file + rename). A mkdir lock serialises writers so the
// scheduled run and an open board can't clobber each other.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveHome(env = process.env) {
  if (env.STUDIO_HOME) return path.resolve(env.STUDIO_HOME);
  return path.join(os.homedir(), 'Documents', 'Fishbowl Studio');
}

export function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function openStore(home = resolveHome()) {
  const stateDir = path.join(home, 'state');
  const lockDir = path.join(stateDir, '.lock');
  let depth = 0;

  const file = (name) => path.join(stateDir, `${name}.json`);
  // Root-level paths resolve inside the data folder or not at all.
  const root = path.resolve(home);
  const inside = (rel) => {
    const p = path.resolve(root, String(rel));
    const r = path.relative(root, p);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new Error(`Refused: ${rel} is outside the studio folder.`);
    return p;
  };

  const store = {
    home,
    stateDir,
    ensure() {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.mkdirSync(path.join(home, 'reports'), { recursive: true });
    },
    read(name, fallback) {
      try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
      catch (e) { if (e.code === 'ENOENT') return clone(fallback); throw e; }
    },
    write(name, value) {
      writeAtomic(file(name), JSON.stringify(value, null, 1));
    },
    update(name, fallback, fn) {
      return store.withLock(() => {
        const v = store.read(name, fallback);
        const out = fn(v);
        store.write(name, out === undefined ? v : out);
        return out === undefined ? v : out;
      });
    },
    // Root-level files they can open and edit themselves.
    readFile(rel, fallback = null) {
      try { return fs.readFileSync(inside(rel), 'utf8'); }
      catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
    },
    writeFile(rel, text) {
      writeAtomic(inside(rel), text);
    },
    exists(rel) {
      return fs.existsSync(inside(rel));
    },
    withLock(fn) {
      if (depth > 0) { depth++; try { return fn(); } finally { depth--; } }
      store.ensure();
      const start = Date.now();
      for (;;) {
        try { fs.mkdirSync(lockDir); break; }
        catch (e) {
          if (e.code !== 'EEXIST') throw e;
          const age = Date.now() - safeMtime(lockDir);
          if (age > 30_000) { try { fs.rmdirSync(lockDir); } catch {} continue; }
          if (Date.now() - start > 10_000) throw new Error('The studio folder is busy (another run holds the lock). Try again in a moment.');
          sleepMs(25);
        }
      }
      depth = 1;
      try { return fn(); } finally { depth = 0; try { fs.rmdirSync(lockDir); } catch {} }
    },
    nextId(kind) {
      return store.withLock(() => {
        const meta = store.read('meta', { ids: {} });
        meta.ids[kind] = (meta.ids[kind] || 0) + 1;
        store.write('meta', meta);
        return meta.ids[kind];
      });
    },
    event(kind, detail = {}, now = Date.now()) {
      store.ensure();
      const line = JSON.stringify({ at: new Date(now).toISOString(), kind, ...detail }) + '\n';
      fs.appendFileSync(path.join(stateDir, 'events.jsonl'), line);
    },
    events(sinceMs = 0) {
      const raw = store.readFile('state/events.jsonl', '');
      return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter((e) => e && Date.parse(e.at) >= sinceMs);
    },
  };
  return store;
}

function safeMtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return Date.now(); }
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
