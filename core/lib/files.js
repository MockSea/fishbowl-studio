// Files shipped inside a package, read by path relative to that package's root. From a checkout
// or npm they come from disk. The standalone build (scripts/build-standalone.mjs) embeds them as
// globalThis.__FISHBOWL_FILES__, a map of path (from the app's root) to text, and nothing is read
// from disk. The core's own files (platforms, shapes, accounts, defaults) sit under the key
// prefix `core/` in that map.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const embedded = () => globalThis.__FISHBOWL_FILES__ || null;
const norm = (rel) => String(rel).split(/[\\/]+/).filter(Boolean).join('/');

// A reader for the package at `root`, whose files are keyed `prefix/...` in the embedded map.
export function ownFiles(root, prefix = '') {
  const pre = prefix ? `${norm(prefix)}/` : '';
  const ROOT = root;

  function readOwn(rel) {
    const files = embedded();
    const key = norm(rel);
    if (!files) return fs.readFileSync(path.join(root, ...key.split('/')), 'utf8');
    if (!Object.hasOwn(files, pre + key)) throw Object.assign(new Error(`ENOENT: ${key}`), { code: 'ENOENT' });
    return files[pre + key];
  }

  // File names directly inside a folder, sorted. Empty if the folder doesn't exist.
  function listOwn(dir) {
    const files = embedded();
    const key = norm(dir);
    if (!files) {
      const abs = path.join(root, ...key.split('/'));
      return fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => fs.statSync(path.join(abs, f)).isFile()).sort() : [];
    }
    const p = `${pre}${key}/`;
    return Object.keys(files).filter((k) => k.startsWith(p) && !k.slice(p.length).includes('/')).map((k) => k.slice(p.length)).sort();
  }

  return { ROOT, readOwn, listOwn };
}

// The folder `fileUrl` (an import.meta.url) sits in, `up` levels higher. In the standalone build
// there is no package on disk (and no import.meta.url): it is then the executable's folder, only
// a label.
export function packageDir(fileUrl, up) {
  return embedded() ? path.dirname(process.execPath) : path.resolve(path.dirname(fileURLToPath(fileUrl)), ...Array(up).fill('..'));
}

// The core package's own root (the folder holding lib/, platforms/, shapes/, accounts/, defaults/).
export const CORE_DIR = packageDir(import.meta.url, 1);
export const { ROOT, readOwn, listOwn } = ownFiles(CORE_DIR, 'core');

// The folders the core needs embedded in a standalone build, relative to CORE_DIR.
export const OWN_DIRS = ['platforms', 'shapes', 'accounts', 'defaults'];
