// The studio's own files (server/ui, platforms, shapes, accounts, defaults), read by path
// relative to the package root. From a checkout or npm they come from disk. The standalone
// build (scripts/build-standalone.mjs) embeds them as globalThis.__FISHBOWL_FILES__, a map of
// relative path to text, and nothing is read from disk.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const embedded = () => globalThis.__FISHBOWL_FILES__ || null;

// The package root. In the standalone build there is none on disk; ROOT is then only a label.
export const ROOT = embedded()
  ? path.dirname(process.execPath)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const norm = (rel) => String(rel).split(/[\\/]+/).filter(Boolean).join('/');

export function readOwn(rel) {
  const files = embedded();
  const key = norm(rel);
  if (!files) return fs.readFileSync(path.join(ROOT, ...key.split('/')), 'utf8');
  if (!Object.hasOwn(files, key)) throw Object.assign(new Error(`ENOENT: ${key}`), { code: 'ENOENT' });
  return files[key];
}

// File names directly inside a folder, sorted. Empty if the folder doesn't exist.
export function listOwn(dir) {
  const files = embedded();
  const key = norm(dir);
  if (!files) {
    const abs = path.join(ROOT, ...key.split('/'));
    return fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => fs.statSync(path.join(abs, f)).isFile()).sort() : [];
  }
  const prefix = `${key}/`;
  return Object.keys(files).filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map((k) => k.slice(prefix.length)).sort();
}

// The folders the standalone build embeds.
export const OWN_DIRS = ['server/ui', 'server/ui/skins', 'platforms', 'shapes', 'accounts', 'defaults'];
