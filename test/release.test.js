// The npx command is pinned to the release tag of this version, and the npm install from GitHub
// carries the locked dependency versions. Bumping the version without updating the command (or
// the other way round) fails here.
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
  for (const f of ['README.md', 'commands/fishbowl.md', '.claude-plugin/plugin.json', 'docs/DEVELOPING.md', 'bin/fishbowl-studio.js']) {
    const refs = read(f).match(/github:MockSea\/fishbowl-studio[^\s`'"):,]*/g) || [];
    assert.ok(refs.length, `${f} has the command`);
    for (const r of refs) assert.equal(r.replace(/\.$/, ''), want, `${f}: ${r}`);
  }
});

test('an install from GitHub carries the locked dependency versions', () => {
  assert.deepEqual([...pkg.bundleDependencies].sort(), Object.keys(pkg.dependencies).sort());
  assert.ok(pkg.scripts.prepare, 'a prepare script makes npm install the clone from the lock file');
  const lock = JSON.parse(read('package-lock.json'));
  for (const [name, range] of Object.entries(pkg.dependencies)) assert.equal(lock.packages[''].dependencies[name], range, `${name} is in the lock file`);
});
