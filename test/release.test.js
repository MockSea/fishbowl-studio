// Everything a person or Claude runs is pinned to the release tag of this version: the npx command,
// the install-script URLs, each install script's own default release, and the skill zip link. The
// npm install from GitHub carries the locked dependency versions. Bumping the version without
// updating all of these (or the other way round) fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('every npx command names the release tag for this version', () => {
  const want = `github:MockSea/fishbowl-studio#v${pkg.version}`;
  for (const f of ['README.md', 'skills/fishbowl-studio/SKILL.md', 'docs/DEVELOPING.md', 'bin/fishbowl-studio.js']) {
    const refs = read(f).match(/github:MockSea\/fishbowl-studio[^\s`'"):,]*/g) || [];
    assert.ok(refs.length, `${f} has the command`);
    for (const r of refs) assert.equal(r.replace(/\.$/, ''), want, `${f}: ${r}`);
  }
});

const DOCS = ['README.md', 'skills/fishbowl-studio/SKILL.md', 'docs/DEVELOPING.md', 'scripts/install.sh', 'scripts/install.ps1'];

test('every install-script URL names the release tag, never a branch', () => {
  let seen = 0;
  for (const f of DOCS) {
    for (const [url, ref] of read(f).matchAll(/https:\/\/raw\.githubusercontent\.com\/MockSea\/fishbowl-studio\/([^/\s]+)\/scripts\/install\.(?:sh|ps1)/g)) {
      assert.equal(ref, `v${pkg.version}`, `${f}: ${url}`);
      seen++;
    }
  }
  assert.ok(/raw\.githubusercontent\.com\/MockSea\/fishbowl-studio\/v[^/]+\/scripts\/install\.sh/.test(read('skills/fishbowl-studio/SKILL.md')), 'the skill has the pinned install.sh URL');
  assert.ok(seen >= 3);
});

test('the install scripts download this release, not the latest one', () => {
  assert.match(read('scripts/install.sh'), new RegExp(`^release=v${pkg.version.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(read('scripts/install.sh'), /^base="https:\/\/github\.com\/\$repo\/releases\/download\/\$\{FISHBOWL_VERSION:-\$release\}"$/m);
  assert.match(read('scripts/install.ps1'), new RegExp(`^\\$release = 'v${pkg.version.replace(/\./g, '\\.')}'$`, 'm'));
  for (const f of DOCS) assert.ok(!/releases\/latest/.test(read(f)), `${f} never points at releases/latest`);
  const zips = read('README.md').match(/releases\/download\/[^/]+\/fishbowl-studio-skill\.zip/g) || [];
  assert.ok(zips.length);
  for (const z of zips) assert.equal(z, `releases/download/v${pkg.version}/fishbowl-studio-skill.zip`);
});

test('an install from GitHub carries the locked dependency versions', () => {
  assert.deepEqual([...pkg.bundleDependencies].sort(), Object.keys(pkg.dependencies).sort());
  assert.ok(pkg.scripts.prepare, 'a prepare script makes npm install the clone from the lock file');
  const lock = JSON.parse(read('package-lock.json'));
  for (const [name, range] of Object.entries(pkg.dependencies)) assert.equal(lock.packages[''].dependencies[name], range, `${name} is in the lock file`);
});
