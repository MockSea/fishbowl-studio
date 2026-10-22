// Personas: one studio per brand she writes for. Each persona is its own folder under
// STUDIO_HOME/personas/<slug>/ holding exactly what a single-brand studio held before
// (settings, voice, sources, state/...). personas.json at the root names them and points at
// the active one. A folder from before personas is moved into personas/<slug>/ on first start.
import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './store.js';
import { oneLine } from './text.js';
import { instructionPhrase } from './fence.js';

export const REGISTRY = 'personas.json';
export const PERSONA_RE = /^[a-z][a-z0-9-]{0,39}$/;
export const MAX_PERSONAS = 12;
// Everything a single-brand studio kept at its root. These move into the persona's folder.
export const LEGACY_ENTRIES = ['settings.json', 'voice.md', 'voice-samples.json', 'beat.json', 'sources.json', 'positions.json', 'audience.json', 'playbook.md', 'shapes.json', 'state', 'reports'];

export function slugify(name, taken = []) {
  const base = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 32).replace(/-+$/, '') || 'brand';
  let slug = base, n = 2;
  while (taken.includes(slug)) slug = `${base}-${n++}`;
  return slug;
}

export function cleanName(name) {
  const n = oneLine(name).slice(0, 60).trim();
  if (!n) throw new Error('A persona needs a name, like "Northwind Bicycles".');
  const hit = instructionPhrase(n);
  if (hit) throw new Error(`That name reads like an instruction ("${hit}"). Use the brand's name.`);
  return n;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function openPersonas(home) {
  const root = path.resolve(home);
  const dir = path.join(root, 'personas');
  const regFile = path.join(root, REGISTRY);
  const lockDir = path.join(root, '.personas.lock');

  function withLock(fn) {
    fs.mkdirSync(root, { recursive: true });
    const start = Date.now();
    for (;;) {
      try { fs.mkdirSync(lockDir); break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let age = 0; try { age = Date.now() - fs.statSync(lockDir).mtimeMs; } catch {}
        if (age > 30_000) { try { fs.rmdirSync(lockDir); } catch {} continue; }
        if (Date.now() - start > 10_000) throw new Error('The studio folder is busy. Try again in a moment.');
        sleepMs(25);
      }
    }
    try { return fn(); } finally { try { fs.rmdirSync(lockDir); } catch {} }
  }

  function read() {
    try { return JSON.parse(fs.readFileSync(regFile, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw new Error('personas.json in the studio folder is not valid JSON. Ask Claude to repair it.'); }
  }
  const write = (reg) => writeAtomic(regFile, JSON.stringify(reg, null, 2) + '\n');

  const brandOf = (folder) => {
    try { return JSON.parse(fs.readFileSync(path.join(folder, 'settings.json'), 'utf8')).brand || ''; } catch { return ''; }
  };

  // Move a pre-personas studio into personas/<slug>/. Never overwrites: if a half-finished
  // migration left a file at the target, the root copy is kept beside it as <name>.legacy-<time>.
  function migrate() {
    const present = LEGACY_ENTRIES.filter((e) => fs.existsSync(path.join(root, e)));
    if (!present.length) return null;
    const existing = fs.existsSync(dir) ? fs.readdirSync(dir).filter((s) => PERSONA_RE.test(s)) : [];
    const brand = brandOf(root);
    const slug = existing.length === 1 ? existing[0] : slugify(brand || 'my-brand', existing);
    const target = path.join(dir, slug);
    fs.mkdirSync(target, { recursive: true });
    for (const e of present) {
      const from = path.join(root, e);
      let to = path.join(target, e);
      if (fs.existsSync(to)) to = `${to}.legacy-${Date.now()}`;
      fs.renameSync(from, to);
    }
    return { slug, name: brand || 'My brand', migrated: present };
  }

  function load() {
    let reg = read();
    if (reg && Array.isArray(reg.personas) && reg.personas.length) {
      // A pre-personas copy of the studio can still appear at the root (an old version wrote
      // there after the move). Fold it in rather than ignore it.
      if (LEGACY_ENTRIES.some((e) => fs.existsSync(path.join(root, e)))) {
        return withLock(() => {
          const m = migrate();
          reg = read();
          if (m && !reg.personas.some((p) => p.slug === m.slug)) { reg.personas.push({ slug: m.slug, name: m.name, created_at: new Date().toISOString() }); write(reg); }
          return reg;
        });
      }
      return reg;
    }
    return withLock(() => {
      reg = read();
      if (reg && Array.isArray(reg.personas) && reg.personas.length) return reg;
      const m = migrate();
      const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter((s) => PERSONA_RE.test(s) && fs.statSync(path.join(dir, s)).isDirectory()).sort() : [];
      const now = new Date().toISOString();
      const personas = found.map((slug) => ({ slug, name: (m && m.slug === slug ? m.name : brandOf(path.join(dir, slug))) || 'My brand', created_at: now, ...(m && m.slug === slug ? { migrated_at: now } : {}) }));
      if (!personas.length) {
        personas.push({ slug: 'my-brand', name: 'My brand', created_at: now });
        fs.mkdirSync(path.join(dir, 'my-brand'), { recursive: true });
      }
      reg = { active: m ? m.slug : personas[0].slug, personas };
      write(reg);
      return reg;
    });
  }

  const reg = {
    root,
    dir: (slug) => {
      if (!PERSONA_RE.test(String(slug))) throw new Error(`"${slug}" is not a persona.`);
      return path.join(dir, slug);
    },
    list: () => load().personas.slice(),
    active() {
      const r = load();
      return r.personas.some((p) => p.slug === r.active) ? r.active : r.personas[0].slug;
    },
    get(slug) {
      const p = load().personas.find((x) => x.slug === slug);
      if (!p) throw new Error(`No persona "${slug}". Personas: ${load().personas.map((x) => x.slug).join(', ')}`);
      return p;
    },
    create(name) {
      const n = cleanName(name);
      return withLock(() => {
        const r = load();
        if (r.personas.length >= MAX_PERSONAS) throw new Error(`At most ${MAX_PERSONAS} personas.`);
        if (r.personas.some((p) => p.name.toLowerCase() === n.toLowerCase())) throw new Error(`There is already a persona called "${n}".`);
        const slug = slugify(n, [...r.personas.map((p) => p.slug), ...(fs.existsSync(dir) ? fs.readdirSync(dir) : [])]);
        fs.mkdirSync(path.join(dir, slug), { recursive: true });
        const p = { slug, name: n, created_at: new Date().toISOString() };
        r.personas.push(p);
        write(r);
        return p;
      });
    },
    switch(slug) {
      return withLock(() => {
        const r = load();
        const p = r.personas.find((x) => x.slug === slug);
        if (!p) throw new Error(`No persona "${slug}".`);
        r.active = slug;
        write(r);
        return p;
      });
    },
    rename(slug, name) {
      const n = cleanName(name);
      return withLock(() => {
        const r = load();
        const p = r.personas.find((x) => x.slug === slug);
        if (!p) throw new Error(`No persona "${slug}".`);
        if (r.personas.some((x) => x !== p && x.name.toLowerCase() === n.toLowerCase())) throw new Error(`There is already a persona called "${n}".`);
        p.name = n;
        write(r);
        return p;
      });
    },
  };
  return reg;
}
