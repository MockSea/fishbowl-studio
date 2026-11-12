// Engine selection (Claude Code or the API key), the claude -p call shape, the fallback when
// Claude Code fails, and the per-run and per-day call caps that cover both engines.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { tempHome } from '../core/test/helpers.js';
import { KEY, app, setUpBrand } from './host-helpers.js';
import { cliArgs, cliInput, parseCliOutput, makeCliModel, MAX_TURNS } from '#core/engines/claude-cli.js';
import { findOnPath, makeEngine } from '#core/engines/index.js';
import { ModelError, SCHEMAS, SYSTEM, makeModel } from '#core/engines/api.js';
import { makeBudget, makeDailyCap } from '#core/runner.js';

test('the claude -p call: no tools, no MCP, no setting sources (no CLAUDE.md), no session, schema and system prompt set', () => {
  const a = cliArgs({ schema: SCHEMAS.triage, model: null });
  const flag = (f) => a[a.indexOf(f) + 1];
  assert.equal(a[0], '-p');
  assert.equal(flag('--input-format'), 'stream-json');
  assert.equal(flag('--output-format'), 'stream-json');
  assert.ok(a.includes('--verbose'), 'stream-json output needs --verbose');
  assert.deepEqual(JSON.parse(flag('--json-schema')), SCHEMAS.triage);
  assert.equal(flag('--tools'), '');
  assert.equal(flag('--system-prompt'), SYSTEM);
  assert.equal(flag('--setting-sources'), '', 'an empty list: no settings files and no CLAUDE.md from any folder');
  assert.ok(a.includes('--strict-mcp-config'));
  assert.ok(a.includes('--no-session-persistence'));
  assert.equal(Number(flag('--max-turns')), MAX_TURNS);
  assert.ok(MAX_TURNS >= 3, 'structured output takes two turns');
  assert.ok(!a.includes('--bare'), '--bare would skip their Claude login');
  assert.ok(!a.includes('--model'));
  assert.equal(cliArgs({ schema: {}, model: 'claude-x' }).at(-1), 'claude-x');
});

test('the claude -p input is one stream-json user message: kit blocks, then the brief, no cache markers', () => {
  const kit = { docs: [{ name: 'a.md', text: 'Say bike, not bicycle.' }], images: [{ name: 'logo.png', media_type: 'image/png', data: 'AAAA' }] };
  const line = cliInput({ task: 'Brief here', kit });
  assert.ok(line.endsWith('\n'));
  assert.equal(line.trim().split('\n').length, 1);
  const msg = JSON.parse(line);
  assert.equal(msg.type, 'user');
  assert.equal(msg.message.role, 'user');
  const c = msg.message.content;
  assert.match(c[0].text, /Say bike, not bicycle/);
  assert.equal(c[2].type, 'image');
  assert.deepEqual(c.at(-1), { type: 'text', text: 'Brief here' });
  assert.ok(!line.includes('cache_control'));
});

test('claude -p output: the result event\'s structured output, or a plain sentence', () => {
  const ok = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    JSON.stringify({ type: 'assistant', message: {} }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { reactions: [] }, total_cost_usd: 0.01 }),
  ].join('\n');
  assert.deepEqual(parseCliOutput(ok), { value: { reactions: [] }, cost: 0.01 });
  assert.deepEqual(parseCliOutput(JSON.stringify({ type: 'result', subtype: 'success', result: '{"takes":[]}' })).value, { takes: [] });
  assert.throws(() => parseCliOutput(''), (e) => e instanceof ModelError && e.kind === 'cli');
  assert.throws(() => parseCliOutput(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true })), (e) => e.kind === 'cli' && /error_max_turns/.test(e.message));
  assert.throws(() => parseCliOutput(JSON.stringify({ type: 'result', subtype: 'success', result: 'not json' })), (e) => e.kind === 'parse');
});

// A child process stand-in: records how it was started and what came in on stdin.
function fakeSpawn(reply) {
  const seen = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => {};
    let input = '';
    child.stdin.on('data', (d) => { input += d; });
    child.stdin.on('finish', () => {
      seen.push({ cmd, args, opts, input, cwdEmpty: fs.readdirSync(opts.cwd).length === 0 });
      const r = reply(input);
      setImmediate(() => { if (r.stdout) child.stdout.write(r.stdout); if (r.stderr) child.stderr.write(r.stderr); child.stdout.end(); child.stderr.end(); child.emit('close', r.code ?? 0); });
    });
    return child;
  };
  return { spawnImpl, seen };
}

test('the adapter runs claude from an empty folder under its own work folder, not the system temp folder', async () => {
  const workDir = path.join(tempHome(), 'app', 'claude-runs');
  const { spawnImpl, seen } = fakeSpawn(() => ({ stdout: JSON.stringify({ type: 'result', subtype: 'success', structured_output: { takes: [] } }) + '\n' }));
  const m = makeCliModel({ bin: '/opt/claude', workDir, spawnImpl });
  assert.deepEqual(await m.ask({ task: 'T', schema: SCHEMAS.takes, kit: null }), { takes: [] });
  assert.equal(seen[0].cmd, '/opt/claude');
  assert.equal(seen[0].cwdEmpty, true);
  assert.equal(path.dirname(seen[0].opts.cwd), workDir);
  assert.ok(!seen[0].opts.cwd.startsWith(os.tmpdir() + path.sep + 'fishbowl-claude-'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(workDir).mode & 0o077, 0, 'only this user can write the work folder');
  assert.throws(() => makeCliModel({ bin: '/opt/claude', spawnImpl }), /workDir/);
  assert.ok(!fs.existsSync(seen[0].opts.cwd), 'the temporary folder is removed');
  assert.equal(JSON.parse(seen[0].input).message.content.at(-1).text, 'T');
  const bad = makeCliModel({ bin: '/opt/claude', workDir, spawnImpl: fakeSpawn(() => ({ code: 1, stderr: 'Not logged in' })).spawnImpl });
  await assert.rejects(bad.ask({ task: 'T', schema: {}, kit: null }), (e) => e.kind === 'cli' && /exit 1: Not logged in/.test(e.message));
});

test('findOnPath finds an executable, and on Windows only an .exe', () => {
  const d = tempHome();
  fs.writeFileSync(path.join(d, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(d, 'claude.cmd'), '');
  if (process.platform !== 'win32') assert.equal(findOnPath('claude', { env: { PATH: d }, platform: 'darwin' }), path.join(d, 'claude'));
  assert.equal(findOnPath('claude', { env: { PATH: d }, platform: 'win32' }), null);
  fs.writeFileSync(path.join(d, 'claude.exe'), '');
  assert.equal(findOnPath('claude', { env: { Path: d }, platform: 'win32' }), path.join(d, 'claude.exe'));
  assert.equal(findOnPath('claude', { env: { PATH: tempHome() }, platform: 'linux' }), null);
});

const keysWith = (k) => ({ has: () => !!k, get: async () => k });
const model = (name, log, fail) => ({ ask: async () => { log.push(name); if (fail) throw fail; return { from: name }; } });

test('engine selection: Claude Code when installed, else the key; preferences pin one', async () => {
  const log = [];
  const mk = (mode, bin, key) => makeEngine({ keys: keysWith(key), mode: () => mode, claudePath: () => bin, createApi: () => model('api', log), createCli: () => model('claude', log) });
  assert.equal(mk('auto', '/c', KEY).pick(), 'claude');
  assert.equal(mk('auto', null, KEY).pick(), 'api');
  assert.equal(mk('auto', null, null).pick(), null);
  assert.equal(mk('api', '/c', KEY).pick(), 'api');
  assert.equal(mk('api', '/c', null).pick(), null);
  assert.equal(mk('claude', '/c', null).pick(), 'claude');
  assert.equal(mk('claude', null, KEY).pick(), null);
  assert.deepEqual(await mk('auto', '/c', KEY).ask({}), { from: 'claude' });
  await assert.rejects(mk('auto', null, null).ask({}), /Add your Anthropic API key/);
  await assert.rejects(mk('claude', null, KEY).ask({}), /Claude Code isn't installed/);
});

test('in auto, a Claude Code failure falls back to the key once, with a message, and stays there', async () => {
  const log = [], notes = [];
  const e = makeEngine({ keys: keysWith(KEY), mode: () => 'auto', claudePath: () => '/c', notify: (m) => notes.push(m),
    createApi: () => model('api', log), createCli: () => model('claude', log, new ModelError('Claude Code stopped (exit 1: Not logged in).', 'cli')) });
  assert.deepEqual(await e.ask({}), { from: 'api' });
  assert.deepEqual(await e.ask({}), { from: 'api' });
  assert.deepEqual(log, ['claude', 'api', 'api']);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /Not logged in.*Using your Anthropic API key instead/);
  assert.equal(e.status().engine, 'api');
  e.reset();
  assert.equal(e.pick(), 'claude', 'a settings change gives Claude Code another go');
  // A refusal or a bad answer is about the brief, not the engine: no fallback.
  const r = makeEngine({ keys: keysWith(KEY), mode: () => 'auto', claudePath: () => '/c', createApi: () => model('api', log), createCli: () => model('claude', log, new ModelError('Claude declined this one.', 'refusal')) });
  await assert.rejects(r.ask({}), (x) => x.kind === 'refusal');
  // Pinned to Claude Code, or no key: the failure is reported, not hidden.
  const p = makeEngine({ keys: keysWith(KEY), mode: () => 'claude', claudePath: () => '/c', createApi: () => model('api', log), createCli: () => model('claude', log, new ModelError('x', 'cli')) });
  await assert.rejects(p.ask({}), (x) => x.kind === 'cli');
  const n = makeEngine({ keys: keysWith(null), mode: () => 'auto', claudePath: () => '/c', createApi: () => model('api', log), createCli: () => model('claude', log, new ModelError('x', 'cli')) });
  await assert.rejects(n.ask({}), (x) => x.kind === 'cli');
});

test('the daily cap persists across restarts, resets the next day, and stops asks', async () => {
  const file = path.join(tempHome(), 'usage.json');
  let t = new Date(2026, 10, 11, 9).getTime();
  const capA = makeDailyCap({ file, cap: 3, now: () => t });
  const asks = [];
  const b = makeBudget({ ask: async (o) => { asks.push(o); return {}; } }, 10, capA);
  await b.ask(1); await b.ask(2);
  const capB = makeDailyCap({ file, cap: 3, now: () => t });
  assert.equal(capB.used(), 2);
  const b2 = makeBudget({ ask: async (o) => { asks.push(o); return {}; } }, 10, capB);
  assert.equal(b2.can(2), false);
  await b2.ask(3);
  await assert.rejects(b2.ask(4), /Today's 3 model calls are used up/);
  assert.deepEqual(asks, [1, 2, 3]);
  t = new Date(2026, 10, 12, 0, 1).getTime();
  assert.equal(capB.left(), 3);
});

test('both engines spend from the same caps: a Claude Code run is capped like an API run', async () => {
  for (const engine of ['claude', 'api']) {
    const calls = [];
    const t = await app({
      dailyCap: 1,
      claudePath: () => (engine === 'claude' ? '/fake/claude' : null),
      createCli: () => ({ ask: async (o) => { calls.push('claude'); return t.api.create({ ...probe(o) }).then(asJson); } }),
      createModel: () => makeModel({ create: async (p) => { calls.push('api'); return t.api.create(p); } }),
    });
    const { host } = t;
    if (engine === 'api') await host.keySet(KEY);
    await setUpBrand(host);
    await host.ask('Run the Fishbowl Studio daily run now.').done;
    const again = await host.ask('Run the Fishbowl Studio daily run now.').done;
    assert.deepEqual(calls, [engine], 'one call, then the day is used up');
    assert.equal(host.daily.used(), 1);
    assert.equal((await host.keyStatus()).engine.engine, engine);
    assert.match(again.message, /today's limit of 1 model calls/);
  }
});

// The fake API answers by request shape; give it one from the CLI adapter's arguments.
const probe = (o) => ({ output_config: { format: { schema: o.schema } }, messages: [{ content: [{ type: 'text', text: o.task }] }] });
const asJson = (msg) => JSON.parse(msg.content[0].text);
