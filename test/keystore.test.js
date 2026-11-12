// The API key: OS stores take it on stdin only; the plaintext file is the 0600 fallback and the
// only place plaintext is ever written; nothing that reaches the page or the logs carries it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from '../core/test/helpers.js';
import { KEY, everything, app, setUpBrand } from './host-helpers.js';
import { makeKeystore, osStore, checkKey, keyAccount, KEY_FILE, MARK_FILE, DPAPI_FILE } from '../server/lib/keystore.js';
import { MISSING_KEY } from '#core/engines/index.js';
import { makeModel } from '#core/engines/api.js';

test('checkKey trims and rejects junk', () => {
  assert.equal(checkKey(`  ${KEY}\n`).key, KEY);
  for (const bad of ['', 'short', 'has a space in it but is long enough', 'x'.repeat(401), 'sk-ant-<script>-aaaaaaaaaaaaaaa', 'sk-ant-aaaaaaaaaaaaaaaaaaaa\n-w evil']) assert.equal(checkKey(bad).ok, false, bad);
});

// A fake of the tools the OS stores call. Records every call; the secret lives only in memory.
function fakeTools({ fail = false } = {}) {
  const calls = [];
  let secret = null;
  const run = async (cmd, args, input = '') => {
    calls.push({ cmd, args, input });
    if (fail) return { code: 1, stdout: '' };
    if (cmd === '/usr/bin/security') {
      if (args[0] === '-i') { secret = input.match(/-w (\S+)/)[1]; return { code: 0, stdout: '' }; }
      if (args[0] === 'find-generic-password') return secret ? { code: 0, stdout: `${secret}\n` } : { code: 44, stdout: '' };
      if (args[0] === 'delete-generic-password') { secret = null; return { code: 0, stdout: '' }; }
    }
    if (cmd === 'secret-tool') {
      if (args[0] === 'store') { secret = input; return { code: 0, stdout: '' }; }
      if (args[0] === 'lookup') return secret ? { code: 0, stdout: secret } : { code: 1, stdout: '' };
      if (args[0] === 'clear') { secret = null; return { code: 0, stdout: '' }; }
    }
    if (cmd === 'powershell.exe') {
      const body = args.at(-1);
      if (body.includes('::Protect(')) return { code: 0, stdout: Buffer.from(`dpapi:${[...input].reverse().join('')}`).toString('base64') };
      if (body.includes('::Unprotect(')) return { code: 0, stdout: [...Buffer.from(input, 'base64').toString().slice(6)].reverse().join('') };
    }
    return { code: 127, stdout: '' };
  };
  return { run, calls, secret: () => secret };
}

const noKeyInArgv = (calls) => { for (const c of calls) assert.ok(!c.args.join(' ').includes(KEY), `${c.cmd} got the key in its arguments`); };

test('macOS: the key goes to the Keychain on stdin, and no file holds it', async () => {
  const dir = tempHome();
  const tools = fakeTools();
  const ks = makeKeystore({ dir, os: osStore({ platform: 'darwin', run: tools.run, dir }), env: {} });
  assert.equal(ks.target(), 'keychain');
  assert.deepEqual(await ks.set(KEY), { ok: true, store: 'keychain', fellBack: false });
  assert.equal(tools.secret(), KEY);
  assert.equal(await ks.get(), KEY);
  assert.equal(ks.where(), 'keychain');
  assert.equal(await ks.hint(), '…WXYZ');
  noKeyInArgv(tools.calls);
  assert.ok(!everything(dir).includes(KEY.slice(0, -4)), 'no plaintext key on disk');
  assert.deepEqual(fs.readdirSync(dir), [MARK_FILE]);
  await ks.clear();
  assert.equal(tools.secret(), null);
  assert.equal(ks.has(), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('Linux with secret-tool: the key goes to the Secret Service on stdin', async () => {
  const dir = tempHome(), bin = tempHome();
  fs.writeFileSync(path.join(bin, 'secret-tool'), '');
  const tools = fakeTools();
  const ks = makeKeystore({ dir, os: osStore({ platform: 'linux', run: tools.run, dir, env: { PATH: bin } }), env: {} });
  assert.equal((await ks.set(KEY)).store, 'secret-service');
  assert.equal(await ks.get(), KEY);
  noKeyInArgv(tools.calls);
  assert.ok(!everything(dir).includes(KEY.slice(0, -4)));
});

test('Linux without secret-tool: the 0600 file, and only that file, holds the key', async () => {
  const dir = tempHome();
  assert.equal(osStore({ platform: 'linux', dir, env: { PATH: tempHome() } }), null);
  const ks = makeKeystore({ dir, os: null, env: {} });
  assert.equal((await ks.set(KEY)).store, 'file');
  assert.equal(await ks.get(), KEY);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(dir, KEY_FILE)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(dir, MARK_FILE)).mode & 0o777, 0o600);
  }
  const holding = fs.readdirSync(dir).filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(KEY.slice(0, -4)));
  assert.deepEqual(holding, [KEY_FILE]);
  await ks.clear();
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('Windows: DPAPI ciphertext on disk, the key passed on stdin', async () => {
  const dir = tempHome();
  const tools = fakeTools();
  const ks = makeKeystore({ dir, os: osStore({ platform: 'win32', run: tools.run, dir }), env: {} });
  assert.equal((await ks.set(KEY)).store, 'dpapi');
  assert.ok(fs.existsSync(path.join(dir, DPAPI_FILE)));
  assert.equal(await ks.get(), KEY);
  noKeyInArgv(tools.calls);
  assert.ok(!everything(dir).includes(KEY.slice(0, -4)), 'no plaintext key on disk');
});

test('when the OS store fails, the key falls back to the 0600 file and says so', async () => {
  const dir = tempHome();
  const tools = fakeTools({ fail: true });
  const ks = makeKeystore({ dir, os: osStore({ platform: 'darwin', run: tools.run, dir }), env: {} });
  assert.deepEqual(await ks.set(KEY), { ok: true, store: 'file', fellBack: true });
  assert.equal(await ks.get(), KEY);
  assert.equal(ks.where(), 'file');
});

test('ANTHROPIC_API_KEY is used read-only when nothing is stored', async () => {
  const dir = tempHome();
  const ks = makeKeystore({ dir, os: null, env: { ANTHROPIC_API_KEY: KEY } });
  assert.equal(ks.has(), true);
  assert.equal(ks.where(), 'env');
  assert.equal(await ks.get(), KEY);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('through the app: the key stays out of the studio folder, the page and the logs', async () => {
  const logs = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.map(String).join(' '));
  try {
    const keysSeen = [];
    const tools = fakeTools();
    const t = await app({ os: osStore({ platform: 'darwin', run: tools.run, dir: tempHome() }), createModel: (apiKey) => { keysSeen.push(apiKey); return makeModel({ create: t.api.create }); } });
    const { host, home, appDir, events } = t;
    const set = await host.keySet(KEY);
    assert.equal(set.ok, true);
    assert.equal(set.hint, '…WXYZ');
    assert.equal(set.where, 'keychain');
    await setUpBrand(host);
    const r = await host.ask('Run the Fishbowl Studio daily run now.').done;
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(keysSeen, [KEY], 'the model was built once, with the stored key');
    const toPage = [set, await host.keyStatus(), await host.call('studio_view', { view: 'apikey' }), await host.call('studio_view', { view: 'settings' }), host.prefsGet(), events, host.kitList()];
    assert.ok(!JSON.stringify(toPage).includes(KEY.slice(0, -4)), 'nothing sent to the page carries the key');
    assert.ok(!JSON.stringify(t.api.requests).includes(KEY.slice(0, -4)), 'the key is not in a prompt');
    assert.ok(!everything(home).includes(KEY.slice(0, -4)), 'not in the studio folder');
    assert.ok(!everything(appDir).includes(KEY.slice(0, -4)), 'not in plaintext in the app folder');
    assert.ok(!logs.join('\n').includes(KEY.slice(0, -4)), 'not logged');
  } finally { Object.assign(console, orig); }
});

// One shared Keychain and Secret Service, with an entry per account, like the real ones.
function sharedStore() {
  const entries = new Map();
  const run = async (cmd, args, input = '') => {
    if (cmd === '/usr/bin/security') {
      if (args[0] === '-i') { const [, a, w] = input.match(/-a (\S+) -w (\S+)/); entries.set(a, w); return { code: 0, stdout: '' }; }
      const a = args[args.indexOf('-a') + 1];
      if (args[0] === 'find-generic-password') return entries.has(a) ? { code: 0, stdout: `${entries.get(a)}\n` } : { code: 44, stdout: '' };
      if (args[0] === 'delete-generic-password') { entries.delete(a); return { code: 0, stdout: '' }; }
    }
    if (cmd === 'secret-tool') {
      const a = args[args.indexOf('account') + 1];
      if (args[0] === 'store') { entries.set(a, input); return { code: 0, stdout: '' }; }
      if (args[0] === 'lookup') return entries.has(a) ? { code: 0, stdout: entries.get(a) } : { code: 1, stdout: '' };
      if (args[0] === 'clear') { entries.delete(a); return { code: 0, stdout: '' }; }
    }
    return { code: 127, stdout: '' };
  };
  return { run, entries };
}

test('two studio folders keep separate keys: removing one leaves the other (W2)', async () => {
  const OTHER = 'sk-ant-api03-OTHERKEY_abcdefghijklmnopqrstuvwxyz0123456789-QRST';
  const bin = tempHome();
  fs.writeFileSync(path.join(bin, 'secret-tool'), '');
  for (const platform of ['darwin', 'linux']) {
    const shared = sharedStore();
    const one = tempHome(), two = tempHome();
    const ks = (dir) => makeKeystore({ dir, os: osStore({ platform, run: shared.run, dir, env: { PATH: bin } }), env: {} });
    assert.notEqual(keyAccount(one), keyAccount(two));
    assert.equal(keyAccount(one), keyAccount(path.join(one, '.')), 'the same folder, however it is written');
    assert.match(keyAccount(one), /^anthropic-api-key-[0-9a-f]{16}$/);
    await ks(one).set(KEY);
    await ks(two).set(OTHER);
    assert.equal(shared.entries.size, 2, platform);
    assert.equal(await ks(one).get(), KEY, platform);
    assert.equal(await ks(two).get(), OTHER, platform);
    await ks(two).clear();
    assert.equal(await ks(one).get(), KEY, `${platform}: the other folder's key is untouched`);
    assert.equal(ks(two).has(), false);
  }
});

test('a saved key deleted from the Keychain behind the studio\'s back: the page says so, and a run says what to do (W2)', async () => {
  const shared = sharedStore();
  const t = await app({ os: osStore({ platform: 'darwin', run: shared.run, dir: tempHome() }) });
  const { host } = t;
  assert.equal((await host.keySet(KEY)).has, true);
  await setUpBrand(host);
  shared.entries.clear();
  const s = await host.keyStatus();
  assert.equal(s.has, false);
  assert.equal(s.missing, 'keychain');
  assert.equal(s.missing_label, 'the macOS Keychain');
  const r = await host.ask('Run the Fishbowl Studio daily run now.').done;
  assert.equal(r.ok, false);
  assert.equal(r.message, MISSING_KEY);
  assert.doesNotMatch(r.message, /null|undefined|reading/);
  assert.equal((await host.keySet(KEY)).has, true, 'saving it again fixes it');
  assert.equal((await host.keyStatus()).missing, null);
});
