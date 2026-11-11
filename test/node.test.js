// Too old a Node.js: the command prints one plain sentence and one fix, not a stack trace.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tooOld } from '../server/lib/old-node.js';
import { PLUGIN_ROOT } from '../server/lib/config.js';

test('on too old a Node, the command prints one plain fix and exits non-zero', () => {
  let text = '';
  const prev = process.exitCode;
  tooOld('18.2.0', 20, { write: (s) => { text += s; } });
  assert.equal(process.exitCode, 1);
  process.exitCode = prev;
  assert.match(text, /^Fishbowl Studio needs a newer Node\.js \(version 20 or later; this computer has 18\.2\.0\)\./);
  assert.doesNotMatch(text, /at .*\.js:\d+|Error:/);
  // The entry point checks the version before it loads anything else.
  const entry = fs.readFileSync(path.join(PLUGIN_ROOT, 'bin', 'fishbowl-studio.js'), 'utf8');
  assert.doesNotMatch(entry, /^import /m, 'no static imports: an old Node must reach the check');
  assert.equal(JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')).engines.node, '>=20');
});
