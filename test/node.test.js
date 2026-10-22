// Too old a Node.js: the server still answers, with one plain sentence and one fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { tooOld } from '../server/lib/old-node.js';
import { PLUGIN_ROOT } from '../server/lib/config.js';

test('on too old a Node, every tool call answers with one plain fix, not a stack trace', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const lines = [];
  output.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean).map((l) => JSON.parse(l))));
  const err = process.stderr.write;
  process.stderr.write = () => true;
  try { tooOld('18.2.0', 20, input, output); } finally { process.stderr.write = err; }
  for (const [id, method] of [[1, 'initialize'], [2, 'tools/list'], [3, 'tools/call']]) input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: { name: 'studio_status' } }) + '\n');
  await new Promise((r) => setTimeout(r, 20));
  const call = lines.find((l) => l.id === 3).result;
  assert.equal(call.isError, true);
  assert.equal(call.content[0].text, 'Fishbowl Studio needs a newer Node.js (version 20 or later; this computer has 18.2.0). To fix it: download the LTS installer from nodejs.org, run it, then quit and reopen Claude.');
  assert.doesNotMatch(call.content[0].text, /at .*\.js:\d+|Error:/);
  assert.equal(lines.find((l) => l.id === 2).result.tools[0].name, 'studio_status');
  // The entry point checks the version before it loads anything else.
  const entry = fs.readFileSync(path.join(PLUGIN_ROOT, 'server', 'index.js'), 'utf8');
  assert.doesNotMatch(entry, /^import /m, 'no static imports: an old Node must reach the check');
  assert.equal(JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')).engines.node, '>=20');
});
