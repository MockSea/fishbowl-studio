// The checks and repairs the command makes before it starts: missing packages end in one sentence
// naming the folder to delete (nothing is installed), a stale lock cleared, our own stuck studio
// stopped (by the lock or by the port) only when it provably is ours, anything else left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensurePackages, brokenPackages, npxEntry, repairSentence, isStudio, lineage, startedAt, STUDIO_COMMAND, stopProcess, alive, portHolder } from '../server/lib/heal.js';
import * as heal from '../server/lib/heal.js';
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

// A stand-in for node that prints what it is told and exits as told.
function fakeNode(stdout, code = 0) {
  const f = path.join(tempHome(), 'node.cjs');
  fs.writeFileSync(f, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(stdout)}); process.exit(${code});\n`, { mode: 0o755 });
  return f;
}

test('a check that fails or answers garbage is "can\'t tell", never "everything is broken"', { skip: !posix }, () => {
  const names = ['a', 'b'];
  assert.equal(brokenPackages(names, { node: fakeNode('not json') }), null);
  assert.equal(brokenPackages(names, { node: fakeNode('["a","b"]', 1) }), null, 'a crashed check');
  assert.equal(brokenPackages(names, { node: fakeNode('{"a":1}') }), null, 'not a list');
  assert.equal(brokenPackages(names, { node: fakeNode('["a","rm -rf"]') }), null, 'names it was not asked about');
  assert.equal(brokenPackages(names, { node: path.join(tempHome(), 'no-node') }), null, 'no node at all');
  assert.deepEqual(brokenPackages(names, { node: fakeNode('["b"]') }), ['b']);
  assert.doesNotThrow(() => ensurePackages({ dir: pkgDir(), check: () => null }), 'an unclear check lets the start go ahead');
});

test('nothing is ever installed: no npm call is left in the start path', () => {
  assert.equal(heal.npmCommand, undefined);
  assert.equal(heal.INSTALL_ARGS, undefined);
  const src = fs.readFileSync(new URL('../server/lib/heal.js', import.meta.url), 'utf8');
  assert.ok(!/npm_execpath|'install'|--no-package-lock/.test(src), 'heal.js runs no npm install');
});

test('missing packages in npx\'s copy: one sentence naming exactly that copy to delete', () => {
  const cache = path.join(tempHome(), '.npm', '_npx', 'cef2c678d56605c4');
  const dir = path.join(cache, 'node_modules', 'fishbowl-studio');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { mammoth: '^1.13.0', unpdf: '^2.1.0' } }));
  assert.equal(npxEntry(dir), cache);
  assert.throws(() => ensurePackages({ dir, check: () => ['mammoth'] }),
    (e) => e.message === `Fishbowl Studio is missing some of its files (mammoth). Delete the folder ${cache} (npm's downloaded copy of the app; your brands aren't in it), then run the same command again: it downloads a fresh copy.`);
});

test('the folder to delete is only ever an npx cache entry', () => {
  const p = (...a) => path.join(path.sep, ...a);
  assert.equal(npxEntry(p('home', 'x', '.npm', '_npx', 'abcdef0123456789', 'node_modules', 'fishbowl-studio')), p('home', 'x', '.npm', '_npx', 'abcdef0123456789'));
  for (const d of [
    p('home', 'x', 'code', 'fishbowl-studio'),
    p('home', 'x', '.npm', '_npx', 'abcdef0123456789', 'node_modules', 'other'),
    p('home', 'x', '.npm', '_npx', 'Documents', 'node_modules', 'fishbowl-studio'),
    p('home', 'x', '.npm', 'notnpx', 'abcdef0123456789', 'node_modules', 'fishbowl-studio'),
  ]) assert.equal(npxEntry(d), null, d);
  const clone = p('home', 'x', 'code', 'fishbowl-studio');
  assert.equal(repairSentence(['unpdf'], clone), `Fishbowl Studio is missing some of its files (unpdf). Run npm ci in ${clone}, then run the command again.`);
});

test('nothing missing: nothing thrown', () => {
  assert.doesNotThrow(() => ensurePackages({ dir: pkgDir(), check: () => [] }));
});

function lockIn(home, lock) {
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  const f = path.join(home, 'app', LOCK_FILE);
  fs.writeFileSync(f, typeof lock === 'string' ? lock : JSON.stringify(lock));
  return f;
}

test('a lock naming our own stuck studio: that studio is stopped and the lock removed', async () => {
  const f = lockIn(tempHome(), { pid: 4242, started: 'S', port: 1, control: 'x' });
  const q = quiet();
  const stopped = [];
  assert.equal(await clearStale(f, { say: q.say, isOurs: (p, started) => p === 4242 && started === 'S', stop: async (p) => { stopped.push(p); return true; } }), 'stopped');
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

// A real process started the way npx starts the studio (node running .../bin/fishbowl-studio.js
// with options), listening on a port, then paused so it holds the port without answering: what a
// stuck studio looks like from outside.
async function stuckStudio(t, { script = path.join('bin', 'fishbowl-studio.js'), args = ['--no-open'] } = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bin-')), script);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `require('http').createServer((q,s)=>s.end('ok')).listen(0,'127.0.0.1',function(){console.log(this.address().port)})`);
  const child = spawn(process.execPath, [file, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => { try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } });
  const port = await new Promise((r) => child.stdout.once('data', (d) => r(Number(String(d).trim()))));
  process.kill(child.pid, 'SIGSTOP');
  return { pid: child.pid, port };
}

test('only a whole studio command line is a studio\'s', () => {
  const npx = '/Users/x/.npm/_npx/cef2c678d56605c4/node_modules';
  for (const c of [
    `node ${npx}/.bin/fishbowl-studio --no-open --link-file --home /Users/x/Documents/Fishbowl Studio`,
    `/opt/homebrew/bin/node ${npx}/fishbowl-studio/bin/fishbowl-studio.js`,
    '/Users/x/.local/bin/fishbowl-studio --no-open',
    'fishbowl-studio',
    '/Users/x/code/fishbowl-studio/node_modules/.bin/node /Users/x/code/fishbowl-studio/bin/fishbowl-studio.js --port 4100',
  ]) assert.ok(STUDIO_COMMAND.test(c), c);
  for (const c of [
    `npm exec github:MockSea/fishbowl-studio#v0.2.0 --no-open`,
    `sh -c fishbowl-studio --no-open`,
    'vim /Users/x/code/fishbowl-studio/bin/fishbowl-studio.js',
    '/usr/bin/less /Users/x/.local/bin/fishbowl-studio',
    'grep -r fishbowl-studio .',
    `node -e require('http').createServer().listen(4100) fishbowl-studio`,
    'node /tmp/evil.js /Users/x/code/fishbowl-studio/bin/fishbowl-studio.js',
    'node /tmp/evil/bin/fishbowl-studio.js.bak',
    'node /tmp/fishbowl-studio/server/cli.js',
    '/Users/x/.local/bin/fishbowl-studio-helper --no-open',
    '/Users/x/.local/bin/fishbowl-studio stop-everything',
    '',
  ]) assert.ok(!STUDIO_COMMAND.test(c), c);
});

test('this process, its parent and its other ancestors are never ours, whatever their command line says', () => {
  const shaped = () => '/Users/x/.local/bin/fishbowl-studio --no-open';
  const yes = { command: shaped, isAlive: () => true, ancestors: () => new Set() };
  assert.equal(isStudio(4242, yes), true);
  assert.equal(isStudio(process.pid, yes), false);
  assert.equal(isStudio(4242, { ...yes, ancestors: () => new Set([4242]) }), false);
  assert.equal(isStudio(1, yes), false);
  if (posix) {
    const mine = lineage();
    assert.ok(mine.has(process.ppid), 'the parent is in the lineage');
    assert.equal(isStudio(process.ppid, { command: shaped, isAlive: () => true }), false);
  }
  const chain = { 10: 9, 9: 8, 8: 1 };
  assert.deepEqual([...lineage(10, (p) => chain[p])], [9, 8]);
  assert.deepEqual([...lineage(10, (p) => ({ 10: 9, 9: 10 })[p])], [9, 10], 'a loop ends');
});

test('given a lock\'s start time, it must match the process\'s; a lock without one never matches', () => {
  const base = { command: () => 'fishbowl-studio', isAlive: () => true, ancestors: () => new Set(), startedOf: () => 'Thu Nov 12 06:48:05 2026' };
  assert.equal(isStudio(4242, { ...base, started: 'Thu Nov 12 06:48:05 2026' }), true);
  assert.equal(isStudio(4242, { ...base, started: 'Thu Nov 12 06:48:06 2026' }), false, 'pid reused by a later studio');
  assert.equal(isStudio(4242, { ...base, started: null }), false);
  assert.equal(isStudio(4242, { ...base, started: '' }), false);
  assert.equal(isStudio(4242, { ...base, started: 'x', startedOf: () => null }), false, 'ps unavailable');
});

test('a real stuck studio is recognised by its command line and start time, and stopped even while paused', { skip: !posix }, async (t) => {
  const s = await stuckStudio(t);
  const started = startedAt(s.pid);
  assert.match(started, /\d{2}:\d{2}:\d{2} \d{4}$/);
  assert.equal(isStudio(s.pid), true);
  assert.equal(isStudio(s.pid, { started }), true);
  assert.equal(isStudio(s.pid, { started: 'Mon Jan  1 00:00:00 2001' }), false);
  assert.equal(portHolder(s.port), s.pid);
  const other = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', 'fishbowl-studio'], { stdio: 'ignore' });
  t.after(() => other.kill('SIGKILL'));
  assert.equal(isStudio(other.pid), false, 'a process that only mentions fishbowl-studio is not ours');
  const lookalike = await stuckStudio(t, { script: path.join('fishbowl-studio', 'notes.js'), args: ['fishbowl-studio'] });
  assert.equal(isStudio(lookalike.pid), false, 'a script in a fishbowl-studio folder is not ours');
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
  lockIn(home, { pid: s.pid, started: startedAt(s.pid), port: s.port, control: 'c'.repeat(64) });
  const a = await app();
  const q = quiet();
  const r = await main(['--home', home, '--no-open'], { out: q.out, signals: false, makeHostImpl: () => a.host });
  t.after(() => r.close());
  assert.ok(r.origin);
  assert.equal(alive(s.pid), false);
  assert.match(q.text(), /earlier start is stuck/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'app', LOCK_FILE), 'utf8')).pid, process.pid);
});

test('start with a lock naming a stuck studio but the wrong start time (or none): nothing is stopped, a new one starts', { skip: !posix }, async (t) => {
  for (const started of ['Mon Jan  1 00:00:00 2001', undefined]) {
    const s = await stuckStudio(t);
    const home = tempHome();
    lockIn(home, { pid: s.pid, started, port: s.port, control: 'c'.repeat(64) });
    const a = await app();
    const q = quiet();
    const r = await main(['--home', home, '--no-open'], { out: q.out, signals: false, makeHostImpl: () => a.host });
    t.after(() => r.close());
    assert.ok(r.origin);
    assert.equal(alive(s.pid), true, 'the process the lock names is left alone');
    assert.match(q.text(), /Cleared a leftover record/);
    assert.doesNotMatch(q.text(), /stuck/);
  }
});
