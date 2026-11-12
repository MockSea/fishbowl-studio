// The repairs the command makes before it starts: missing packages reinstalled once, a stale lock
// cleared, our own stuck studio stopped (by the lock or by the port), anything else left alone, and
// a plain sentence when a repair fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensurePackages, brokenPackages, isStudio, stopProcess, alive, portHolder } from '../server/lib/heal.js';
import { clearStale, freePort, main, LOCK_FILE } from '../server/cli.js';
import { app } from './host-helpers.js';
import { tempHome } from '../core/test/helpers.js';

const posix = process.platform !== 'win32';

function pkgDir(deps = { 'left-pad-not-here': '1.0.0' }) {
  const dir = tempHome();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', type: 'module', dependencies: deps }));
  return dir;
}

function quiet() {
  const lines = [];
  return { say: (s) => lines.push(s), out: { write: (s) => lines.push(s) }, text: () => lines.join('\n') };
}

test('a package that does not load is found by loading it in a separate process', () => {
  const dir = pkgDir();
  assert.deepEqual(brokenPackages(['node:fs', 'left-pad-not-here'], { cwd: dir }), ['left-pad-not-here']);
  fs.mkdirSync(path.join(dir, 'node_modules', 'left-pad-not-here'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'left-pad-not-here', 'package.json'), '{"name":"left-pad-not-here","main":"i.js"}');
  fs.writeFileSync(path.join(dir, 'node_modules', 'left-pad-not-here', 'i.js'), 'module.exports = 1;');
  assert.deepEqual(brokenPackages(['left-pad-not-here'], { cwd: dir }), []);
});

test('missing packages are reinstalled once and checked again', () => {
  const dir = pkgDir();
  const q = quiet();
  let checks = 0, installs = 0;
  const fixed = ensurePackages({ dir, say: q.say, check: () => (checks++ ? [] : ['left-pad-not-here']), install: () => { installs++; return true; } });
  assert.deepEqual(fixed, ['left-pad-not-here']);
  assert.equal(installs, 1);
  assert.match(q.text(), /missing some of its files \(left-pad-not-here\)\. Repairing/);
  assert.match(q.text(), /Repaired\./);
});

test('nothing missing: no install, nothing said', () => {
  const q = quiet();
  assert.deepEqual(ensurePackages({ dir: pkgDir(), say: q.say, check: () => [], install: () => assert.fail('no install') }), []);
  assert.equal(q.text(), '');
});

test('a repair that fails ends in one plain sentence', () => {
  const dir = pkgDir();
  assert.throws(() => ensurePackages({ dir, say: () => {}, check: () => ['left-pad-not-here'], install: () => false }),
    /^Error: Fishbowl Studio couldn't repair its files \(left-pad-not-here still missing\)\. Check that this computer is online, then run the same command again\.$/);
  assert.throws(() => ensurePackages({ dir, say: () => {}, check: () => ['left-pad-not-here'], install: () => true }), /still missing/);
});

function lockIn(home, lock) {
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  const f = path.join(home, 'app', LOCK_FILE);
  fs.writeFileSync(f, typeof lock === 'string' ? lock : JSON.stringify(lock));
  return f;
}

test('a lock naming our own stuck studio: that studio is stopped and the lock removed', async () => {
  const f = lockIn(tempHome(), { pid: 4242, port: 1, control: 'x' });
  const q = quiet();
  const stopped = [];
  assert.equal(await clearStale(f, { say: q.say, isOurs: (p) => p === 4242, stop: async (p) => { stopped.push(p); return true; } }), 'stopped');
  assert.deepEqual(stopped, [4242]);
  assert.equal(fs.existsSync(f), false);
  assert.match(q.text(), /earlier start is stuck \(process 4242\)\. Restarting it\./);
});

test('a stuck studio that will not stop ends in one plain sentence and the lock stays', async () => {
  const f = lockIn(tempHome(), { pid: 4242, port: 1, control: 'x' });
  await assert.rejects(clearStale(f, { say: () => {}, isOurs: () => true, stop: async () => false }), /couldn't be stopped\. Restart the computer, then run the command again\./);
  assert.equal(fs.existsSync(f), true);
});

test('a lock naming a process that is gone, someone else\'s, or unreadable is cleared without stopping anything', async () => {
  for (const lock of [{ pid: 2 ** 30, port: 1, control: 'x' }, { pid: process.pid }, 'not json']) {
    const f = lockIn(tempHome(), lock);
    const q = quiet();
    assert.equal(await clearStale(f, { say: q.say, stop: async () => assert.fail('nothing to stop') }), 'cleared');
    assert.equal(fs.existsSync(f), false);
    assert.match(q.text(), /Cleared a leftover record/);
  }
  assert.equal(await clearStale(path.join(tempHome(), 'none.json'), { say: () => assert.fail('nothing to say') }), null);
});

test('--port held by our own stuck studio is freed; held by anything else, a free port is used', async () => {
  const q = quiet();
  const stopped = [];
  const stop = async (p) => { stopped.push(p); return true; };
  assert.equal(await freePort(4100, { say: q.say, holder: () => 77, isOurs: () => true, isAnswering: async () => false, stop }), 4100);
  assert.deepEqual(stopped, [77]);
  assert.match(q.text(), /stuck on port 4100 \(process 77\)\. Restarting it\./);
  assert.equal(await freePort(4100, { say: q.say, holder: () => 77, isOurs: () => true, isAnswering: async () => true, stop }), 0, 'a studio that answers keeps its port');
  assert.equal(await freePort(4100, { say: q.say, holder: () => 77, isOurs: () => false, isAnswering: async () => false, stop }), 0);
  assert.equal(await freePort(4100, { say: q.say, holder: () => null, stop }), 0);
  assert.deepEqual(stopped, [77], 'only the stuck studio was stopped');
  assert.match(q.text(), /Port 4100 is in use by another program\. Using a free port instead\./);
});

// A real process whose command line says fishbowl-studio, listening on a port, then paused so it
// holds the port without answering: what a stuck studio looks like from outside.
async function stuckStudio(t) {
  const child = spawn(process.execPath, ['-e', `require('http').createServer((q,s)=>s.end('ok')).listen(0,'127.0.0.1',function(){console.log(this.address().port)})`, 'fishbowl-studio-test'], { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => { try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } });
  const port = await new Promise((r) => child.stdout.once('data', (d) => r(Number(String(d).trim()))));
  process.kill(child.pid, 'SIGSTOP');
  return { pid: child.pid, port };
}

test('a real stuck studio is recognised by its command line and stopped even while paused', { skip: !posix }, async (t) => {
  const s = await stuckStudio(t);
  assert.equal(isStudio(s.pid), true);
  assert.equal(portHolder(s.port), s.pid);
  const other = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  t.after(() => other.kill('SIGKILL'));
  assert.equal(isStudio(other.pid), false, 'a process not started as fishbowl-studio is not ours');
  assert.equal(isStudio(process.pid), false, 'never this process');
  assert.equal(await stopProcess(s.pid), true);
  assert.equal(alive(s.pid), false);
});

test('start with --port held by a stuck studio: it is stopped and the new studio takes the port', { skip: !posix }, async (t) => {
  const s = await stuckStudio(t);
  const a = await app();
  const q = quiet();
  const r = await main(['--home', tempHome(), '--no-open', '--port', String(s.port)], { out: q.out, signals: false, makeHostImpl: () => a.host });
  t.after(() => r.close());
  assert.equal(r.origin, `http://127.0.0.1:${s.port}`);
  assert.equal(alive(s.pid), false);
  assert.match(q.text(), /stuck on port/);
});

test('start with --port held by another program: it is left alone and a free port is used', async (t) => {
  const other = http.createServer((req, res) => res.end('mine'));
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => other.close(r)));
  const port = other.address().port;
  const a = await app();
  const q = quiet();
  const r = await main(['--home', tempHome(), '--no-open', '--port', String(port)], { out: q.out, signals: false, makeHostImpl: () => a.host });
  t.after(() => r.close());
  assert.notEqual(r.origin, `http://127.0.0.1:${port}`);
  assert.match(q.text(), new RegExp(`Port ${port} is in use by another program`));
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'mine');
});

test('start with a lock naming a stuck studio for this folder: it is stopped and a new one starts', { skip: !posix }, async (t) => {
  const s = await stuckStudio(t);
  const home = tempHome();
  lockIn(home, { pid: s.pid, port: s.port, control: 'c'.repeat(64) });
  const a = await app();
  const q = quiet();
  const r = await main(['--home', home, '--no-open'], { out: q.out, signals: false, makeHostImpl: () => a.host });
  t.after(() => r.close());
  assert.ok(r.origin);
  assert.equal(alive(s.pid), false);
  assert.match(q.text(), /earlier start is stuck/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'app', LOCK_FILE), 'utf8')).pid, process.pid);
});
