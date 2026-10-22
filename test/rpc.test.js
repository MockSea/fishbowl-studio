// Spawn the real server over stdio and talk MCP to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempHome } from './helpers.js';
import { handleLine, makeHandlers } from '../server/lib/rpc.js';
import { makeContext } from '../server/lib/state.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'index.js');

function startServer() {
  const home = tempHome();
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, STUDIO_HOME: home, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = new Map();
  const stray = [];
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      if (waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } else stray.push(msg);
    }
  });
  let id = 0;
  const send = (method, params) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  const raw = (line) => child.stdin.write(line + '\n');
  return { child, send, raw, stray, home };
}

test('stdio MCP: initialize, tools/list, a tool call, the UI resource, errors', async (t) => {
  const s = startServer();
  t.after(() => s.child.kill());
  const disc = await s.send('server/discover', {});
  assert.equal(disc.error.code, -32601, 'legacy server: discover is method-not-found so hosts fall back');
  const init = await s.send('initialize', { protocolVersion: '2025-06-18', capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } }, clientInfo: { name: 'test', version: '0' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.deepEqual(Object.keys(init.result.capabilities).sort(), ['resources', 'tools']);
  const odd = await s.send('initialize', { protocolVersion: '1999-01-01' });
  assert.equal(odd.result.protocolVersion, '2025-11-25');
  s.raw(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.deepEqual((await s.send('ping')).result, {});

  const list = await s.send('tools/list');
  const names = list.result.tools.map((x) => x.name);
  assert.ok(names.every((n) => /^studio_[a-z_]+$/.test(n)));
  const board = list.result.tools.find((x) => x.name === 'studio_board');
  assert.equal(board._meta.ui.resourceUri, 'ui://studio/board');
  assert.equal(board._meta['ui/resourceUri'], 'ui://studio/board');

  const call = await s.send('tools/call', { name: 'studio_status', arguments: {} });
  assert.match(call.result.content[0].text, /Setup isn't finished/);
  assert.match(call.result.content[0].text, new RegExp(s.home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const b = await s.send('tools/call', { name: 'studio_board', arguments: {} });
  assert.ok(b.result.structuredContent.header);

  const bad = await s.send('tools/call', { name: 'nope', arguments: {} });
  assert.equal(bad.error.code, -32602);
  const toolErr = await s.send('tools/call', { name: 'studio_act', arguments: { action: 'pass', id: 12345 } });
  assert.equal(toolErr.result.isError, true);

  const res = await s.send('resources/list');
  assert.equal(res.result.resources[0].mimeType, 'text/html;profile=mcp-app');
  const read = await s.send('resources/read', { uri: 'ui://studio/board' });
  const c = read.result.contents[0];
  assert.equal(c.mimeType, 'text/html;profile=mcp-app');
  assert.match(c.text, /^<!DOCTYPE html>/i);
  assert.equal(c._meta.ui.domain, undefined, 'no ui.domain for stdio servers');
  const missing = await s.send('resources/read', { uri: 'ui://studio/nope' });
  assert.equal(missing.error.code, -32002);
  assert.deepEqual((await s.send('resources/templates/list')).result, { resourceTemplates: [] });
  assert.equal((await s.send('made/up')).error.code, -32601);
});

test('malformed input: parse errors, batches, notifications', async () => {
  const h = makeHandlers(makeContext({ home: tempHome() }));
  assert.equal((await handleLine(h, '{not json')).error.code, -32700);
  assert.equal((await handleLine(h, '[{"jsonrpc":"2.0","id":1,"method":"ping"}]')).error.code, -32600);
  assert.equal(await handleLine(h, '{"jsonrpc":"2.0","method":"notifications/cancelled"}'), null);
  assert.equal(await handleLine(h, '   '), null);
});

test('the server exits when stdin closes', async () => {
  const s = startServer();
  const code = await new Promise((resolve) => { s.child.on('exit', resolve); s.child.stdin.end(); });
  assert.equal(code, 0);
});

test('the board resource is one self-contained HTML document', async () => {
  const { boardHtml } = await import('../server/lib/rpc.js');
  const html = boardHtml();
  assert.doesNotMatch(html, /__CSS__|__BRIDGE__|__VIEWS__/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+stylesheet/i, 'no external scripts or styles');
  assert.match(html, /name="color-scheme" content="light dark"/);
  assert.match(html, /ui\/initialize/);
  assert.ok(html.length < 150000);
});
