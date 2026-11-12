#!/usr/bin/env node
// Builds the standalone executable for the computer it runs on: one file with Node and the studio
// inside, so it runs where Node isn't installed. Uses Node's single executable applications
// (`node --build-sea`, Node 25.5 or newer) on a one-file bundle made by esbuild.
//
//   node scripts/build-standalone.mjs            -> dist/fishbowl-studio-<os>-<arch>[.exe]
//   node scripts/build-standalone.mjs --out FILE
//
// The studio's own files (the board, package.json, and the core's platforms, shapes, accounts and
// defaults) go into the bundle as globalThis.__FISHBOWL_FILES__ (see core/lib/files.js), so
// nothing is read from next to the executable. The release workflow (.github/workflows/release.yml) runs this on one
// runner per platform.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { OWN_DIRS as CORE_DIRS } from '../core/lib/files.js';
import { OWN_DIRS as APP_DIRS } from '../server/lib/files.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWN_DIRS = [...APP_DIRS, ...CORE_DIRS.map((d) => `core/${d}`)];
const EXTRA = ['package.json'];

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 25 || (major === 25 && minor < 5)) {
  console.error(`The standalone build needs Node 25.5 or newer (node --build-sea). This is ${process.version}.`);
  process.exit(1);
}

const os = { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform] || process.platform;
const name = `fishbowl-studio-${os}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
const i = process.argv.indexOf('--out');
const out = path.resolve(i > 0 ? process.argv[i + 1] : path.join(ROOT, 'dist', name));
const work = path.join(ROOT, 'dist', 'build');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(path.dirname(out), { recursive: true });

// Every file directly inside each folder, as text, keyed by its path from the package root.
const files = {};
for (const dir of OWN_DIRS) {
  for (const f of fs.readdirSync(path.join(ROOT, dir)).sort()) {
    const abs = path.join(ROOT, dir, f);
    if (fs.statSync(abs).isFile()) files[`${dir}/${f}`] = fs.readFileSync(abs, 'utf8');
  }
}
for (const f of EXTRA) files[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const bundle = path.join(work, 'fishbowl-studio.cjs');
await build({
  entryPoints: [path.join(ROOT, 'bin', 'fishbowl-studio.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: bundle,
  banner: { js: `globalThis.__FISHBOWL_FILES__ = ${JSON.stringify(files)};` },
  // Lines like `#!/usr/bin/env node` in the entry are dropped; a SEA main script can't have one.
  logLevel: 'warning',
  logOverride: { 'empty-import-meta': 'silent' },
});

const config = path.join(work, 'sea-config.json');
fs.writeFileSync(config, JSON.stringify({
  main: bundle,
  output: out,
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  useSnapshot: false,
}, null, 2));
execFileSync(process.execPath, ['--build-sea', config], { stdio: 'inherit' });

// macOS refuses to run an arm64 binary whose signature no longer matches; sign it ad hoc.
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', '--force', out], { stdio: 'inherit' });
fs.chmodSync(out, 0o755);
fs.rmSync(work, { recursive: true, force: true });
console.log(`Built ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
