import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.js';
import { KEY, fakeSafeStorage, everything, app, setUpBrand } from './desktop-helpers.js';
import { makeKeystore, checkKey, KEY_FILE } from '../desktop/keystore.js';
import { makeModel } from '../desktop/llm.js';

test('checkKey trims and rejects junk', () => {
  assert.equal(checkKey(`  ${KEY}\n`).key, KEY);
  for (const bad of ['', 'short', 'has a space in it but is long enough', 'x'.repeat(401), 'sk-ant-<script>-aaaaaaaaaaaaaaa']) assert.equal(checkKey(bad).ok, false, bad);
});

test('the key is stored encrypted, owner-only, and reads back', async () => {
  const dir = tempHome();
  const ks = makeKeystore({ dir, safeStorage: fakeSafeStorage() });
  assert.equal(ks.has(), false);
  assert.deepEqual(await ks.set(KEY), { ok: true });
  assert.equal(await ks.get(), KEY);
  assert.equal(await ks.hint(), '…WXYZ');
  assert.equal(fs.statSync(path.join(dir, KEY_FILE)).mode & 0o777, 0o600);
  assert.ok(!everything(dir).includes(KEY), 'no plaintext key on disk');
  assert.ok(!everything(dir).includes(KEY.slice(10, 30)), 'not even part of it');
  ks.clear();
  assert.equal(ks.has(), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('with no encryption available the key is refused, never written in the clear', async () => {
  const dir = tempHome();
  const ks = makeKeystore({ dir, safeStorage: fakeSafeStorage({ available: false }) });
  const r = await ks.set(KEY);
  assert.equal(r.ok, false);
  assert.match(r.reason, /can't encrypt/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('through the app: the key stays out of the studio folder, the app folder, the window and the logs', async () => {
  const logs = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.map(String).join(' '));
  try {
    const keysSeen = [];
    const t = await app({ createModel: (apiKey) => { keysSeen.push(apiKey); return makeModel({ create: t.api.create }); } });
    const { host, home, appDir, events } = t;
    const set = await host.keySet(KEY);
    assert.equal(set.ok, true);
    assert.equal(set.hint, '…WXYZ');
    await setUpBrand(host);
    const r = await host.ask('Run the Fishbowl Studio daily run now.').done;
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(keysSeen, [KEY], 'the model was built once, with the stored key');
    const toWindow = [set, await host.keyStatus(), await host.call('studio_view', { view: 'apikey' }), await host.call('studio_view', { view: 'settings' }), host.prefsGet(), events, host.kitList()];
    const shown = JSON.stringify(toWindow);
    assert.ok(!shown.includes(KEY.slice(0, -4)), 'nothing sent to the window carries the key');
    assert.ok(!JSON.stringify(t.api.requests).includes(KEY.slice(0, -4)), 'the key is not in a prompt');
    assert.ok(!everything(home).includes(KEY.slice(0, -4)), 'not in the studio folder');
    assert.ok(!everything(appDir).includes(KEY.slice(0, -4)), 'not in plaintext in the app folder');
    assert.ok(!logs.join('\n').includes(KEY.slice(0, -4)), 'not logged');
  } finally { Object.assign(console, orig); }
});
