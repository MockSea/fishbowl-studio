// The fishbowl-studio command: its options, how it opens the browser on each system, the lock
// file a second copy reads, and reusing a running copy instead of starting another.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, browserCommand, main, LOCK_FILE } from '../server/cli.js';
import { app } from './host-helpers.js';
import { tempHome } from './helpers.js';

test('options', () => {
  assert.deepEqual(parseArgs([]), { open: true, port: 0, home: null, help: false, version: false });
  const o = parseArgs(['--no-open', '--port', '4100', '--home', 'x']);
  assert.equal(o.open, false);
  assert.equal(o.port, 4100);
  assert.equal(o.home, path.resolve('x'));
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['-v']).version, true);
  assert.throws(() => parseArgs(['--port']), /needs a value/);
  assert.throws(() => parseArgs(['--port', '0']), /1 to 65535/);
  assert.throws(() => parseArgs(['--port', 'abc']), /1 to 65535/);
  assert.throws(() => parseArgs(['--rm']), /Unknown option --rm/);
});

test('the browser opens with the system command, the link as one argument', () => {
  const url = 'http://127.0.0.1:4100/?t=abc&x=1';
  assert.deepEqual(browserCommand(url, 'darwin'), ['open', [url]]);
  assert.deepEqual(browserCommand(url, 'linux'), ['xdg-open', [url]]);
  assert.deepEqual(browserCommand(url, 'win32'), ['rundll32', ['url.dll,FileProtocolHandler', url]]);
});

function quiet() {
  const lines = [];
  return { out: { write: (s) => lines.push(s) }, text: () => lines.join('') };
}

test('starts, prints a one-time link, writes a private lock, and a second run reuses it', async (t) => {
  const home = tempHome();
  const opened = [];
  const a = await app();
  const one = quiet();
  const first = await main(['--home', home], { out: one.out, open: (u) => opened.push(u), signals: false, makeHostImpl: () => a.host });
  t.after(() => first.close());
  assert.match(one.text(), /Fishbowl Studio is running/);
  assert.match(one.text(), new RegExp(`Studio folder: ${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(one.text(), /Open it here \(the link works once\): http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]{64}/);
  assert.equal(opened.length, 1);
  assert.ok(opened[0].startsWith(`${first.origin}/?t=`));

  const lockFile = path.join(home, 'app', LOCK_FILE);
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  assert.equal(lock.pid, process.pid);
  assert.equal(`http://127.0.0.1:${lock.port}`, first.origin);
  if (process.platform !== 'win32') assert.equal(fs.statSync(lockFile).mode & 0o777, 0o600);

  const two = quiet();
  const second = await main(['--home', home, '--no-open'], { out: two.out, open: (u) => opened.push(u), signals: false, makeHostImpl: () => { throw new Error('should not start a second'); } });
  assert.ok(second.reused.startsWith(`${first.origin}/?t=`));
  assert.notEqual(second.reused, opened[0], 'a fresh link');
  assert.match(two.text(), /already running/);
  assert.equal(opened.length, 1, '--no-open');

  await first.close();
  assert.equal(fs.existsSync(lockFile), false, 'removed on the way out');
});

test('a stale lock from a copy that is gone does not stop a new start', async (t) => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.writeFileSync(path.join(home, 'app', LOCK_FILE), JSON.stringify({ pid: 2 ** 30, port: 1, control: 'x' }));
  const a = await app();
  const r = await main(['--home', home, '--no-open'], { out: quiet().out, signals: false, makeHostImpl: () => a.host });
  t.after(() => r.close());
  assert.ok(r.origin);
});

test('a folder it cannot write to gets a plain fix, not a stack trace', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const home = tempHome();
  fs.chmodSync(home, 0o500);
  try {
    await assert.rejects(main(['--home', path.join(home, 'studio'), '--no-open'], { out: quiet().out, signals: false }), /can't write to .*--home <folder>/);
  } finally { fs.chmodSync(home, 0o700); }
});
