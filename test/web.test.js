// The local server's guard rails: where it listens, the one-time launch link and the cookie, the
// Host check, what the API accepts, uploads, and the control call a second copy uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeServer, TOKEN_TTL_MS, MAX_JSON_BYTES, MAX_UPLOAD_BYTES } from '../server/lib/web.js';
import { app } from './host-helpers.js';

function fakeHost() {
  const seen = [];
  const host = {
    seen,
    call: async (name, args) => { seen.push(['call', name, args]); return { structuredContent: { view: 'drafts' } }; },
    ask: (text) => { seen.push(['ask', text]); return { ok: true, kind: 'rewrites' }; },
    keyStatus: () => ({ has: false }),
    keySet: (k) => { seen.push(['keySet', k]); return { ok: true }; },
    keyClear: () => ({ ok: true }),
    kitList: () => ({ files: [] }),
    kitAdd: async (files) => {
      seen.push(['kitAdd', files.map((f) => ({ ...f, existed: fs.existsSync(f.path), bytes: fs.readFileSync(f.path).length }))]);
      return { results: files.map((f) => ({ ok: true, name: f.name })), kit: { files: [] } };
    },
    kitRemove: (id) => ({ ok: true, id }),
    prefsGet: () => ({ autorun: false, engine: 'auto' }),
    prefsSet: (p) => p,
  };
  return host;
}

// Plain http.request, so the test can send any Host and Origin it likes.
function req(port, { method = 'GET', path: p = '/', headers = {}, body = null, chunks = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on('error', (e) => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? resolve({ status: 0, reset: true }) : reject(e)));
    if (chunks) { (async () => { for (const c of chunks) { if (!r.write(c)) await new Promise((ok) => r.once('drain', ok)); } r.end(); })().catch(() => {}); }
    else r.end(body);
  });
}

async function started(opts = {}) {
  const host = opts.host || fakeHost();
  const clock = { t: 1_800_000_000_000 };
  const srv = makeServer({ host, now: () => clock.t, page: () => '<!doctype html><script>a()</script><p>board</p><script>b()</script>', ...opts });
  const { port } = await srv.listen();
  const t = new URL(srv.launchUrl()).searchParams.get('t');
  const r = await req(port, { path: `/?t=${t}` });
  const cookie = r.headers['set-cookie'][0].split(';')[0];
  const origin = `http://127.0.0.1:${port}`;
  const api = (name, body = {}, headers = {}) => req(port, { method: 'POST', path: `/api/${name}`, headers: { cookie, origin, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { srv, host, port, cookie, origin, api, clock };
}

test('it listens on 127.0.0.1 only and sends no CORS headers', async (t) => {
  const s = await started();
  t.after(() => s.srv.close());
  assert.equal(s.srv.server.address().address, '127.0.0.1');
  const all = [await req(s.port), await req(s.port, { headers: { cookie: s.cookie, origin: 'https://evil.example' } }), await s.api('prefs/get'), await s.api('call', {}, { origin: 'https://evil.example' })];
  for (const r of all) assert.ok(!Object.keys(r.headers).some((k) => k.startsWith('access-control-')), JSON.stringify(r.headers));
});

test('the launch link works once, within its time, and swaps for a strict HttpOnly cookie', async (t) => {
  const s = await started();
  t.after(() => s.srv.close());
  assert.equal((await req(s.port)).status, 403, 'no cookie, no page');
  const tok = new URL(s.srv.launchUrl()).searchParams.get('t');
  const r = await req(s.port, { path: `/?t=${tok}` });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/');
  const set = r.headers['set-cookie'][0];
  assert.match(set, new RegExp(`^fishbowl_${s.port}=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=/$`), 'named for the port: cookies do not keep ports apart');
  assert.equal((await req(s.port, { path: `/?t=${tok}` })).status, 403, 'used once');
  assert.match((await req(s.port, { path: `/?t=${tok}` })).text, /Open the studio from its link/);
  assert.equal((await req(s.port, { path: '/?t=made-up' })).status, 403);
  const late = new URL(s.srv.launchUrl()).searchParams.get('t');
  s.clock.t += TOKEN_TTL_MS + 1;
  assert.equal((await req(s.port, { path: `/?t=${late}` })).status, 403, 'expired');
  assert.equal((await req(s.port, { headers: { cookie: `fishbowl_${s.port}=${'0'.repeat(64)}` } })).status, 403, 'a guessed cookie');
  assert.equal((await req(s.port, { headers: { cookie: s.cookie } })).status, 200);
});

test('the page gets a fresh script nonce and a CSP that allows nothing else', async (t) => {
  const s = await started();
  t.after(() => s.srv.close());
  const a = await req(s.port, { headers: { cookie: s.cookie } });
  const b = await req(s.port, { headers: { cookie: s.cookie } });
  const csp = a.headers['content-security-policy'];
  const nonce = csp.match(/script-src 'nonce-([^']+)'/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.equal(a.text.match(/<script nonce="([^"]+)">/g).length, 2);
  assert.ok(a.text.match(/<script nonce="([^"]+)">/g).every((x) => x.includes(nonce)));
  assert.doesNotMatch(a.text, /<script>/);
  assert.notEqual(nonce, b.headers['content-security-policy'].match(/'nonce-([^']+)'/)[1]);
  assert.equal(a.headers['x-frame-options'], 'DENY');
  assert.equal(a.headers['x-content-type-options'], 'nosniff');
  assert.equal(a.headers['cache-control'], 'no-store');
});

test('a request for any other host name is refused (DNS rebinding)', async (t) => {
  const s = await started();
  t.after(() => s.srv.close());
  for (const host of ['evil.example', `evil.example:${s.port}`, `127.0.0.1:${s.port + 1}`, '127.0.0.1', `[::1]:${s.port}`]) {
    const r = await req(s.port, { path: '/api/prefs/get', method: 'POST', headers: { host, cookie: s.cookie, origin: s.origin, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 421, host);
  }
  const noHost = await new Promise((resolve) => {
    const c = net.connect(s.port, '127.0.0.1', () => c.end(`GET / HTTP/1.0\r\ncookie: ${s.cookie}\r\n\r\n`));
    let buf = '';
    c.on('data', (d) => { buf += d; });
    c.on('close', () => resolve(buf));
  });
  assert.match(noHost, /^HTTP\/1\.[01] (421|400)/, 'no Host at all');
  assert.equal((await req(s.port, { headers: { host: `localhost:${s.port}`, cookie: s.cookie } })).status, 200);
});

test('the API takes only same-origin JSON POSTs with the cookie', async (t) => {
  const s = await started();
  t.after(() => s.srv.close());
  const ok = await s.api('call', { name: 'studio_view', args: { view: 'drafts' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(s.host.seen.at(-1), ['call', 'studio_view', { view: 'drafts' }]);
  const n = s.host.seen.length;
  const refused = {
    'no cookie': await req(s.port, { method: 'POST', path: '/api/call', headers: { origin: s.origin, 'content-type': 'application/json' }, body: '{}' }),
    'no Origin': await req(s.port, { method: 'POST', path: '/api/call', headers: { cookie: s.cookie, 'content-type': 'application/json' }, body: '{}' }),
    'another site': await s.api('call', {}, { origin: 'https://evil.example' }),
    'null origin': await s.api('call', {}, { origin: 'null' }),
    'another port': await s.api('call', {}, { origin: `http://127.0.0.1:${s.port + 1}` }),
    'cross-site fetch': await s.api('call', {}, { 'sec-fetch-site': 'cross-site' }),
    'same-site fetch': await s.api('call', {}, { 'sec-fetch-site': 'same-site' }),
    'a form post': await s.api('call', 'name=studio_act', { 'content-type': 'application/x-www-form-urlencoded' }),
    'text/plain': await s.api('call', '{}', { 'content-type': 'text/plain' }),
    'GET': await req(s.port, { path: '/api/call', headers: { cookie: s.cookie, origin: s.origin } }),
    'not JSON': await s.api('call', '{nope'),
    'an array': await s.api('call', '[]'),
    'unknown route': await s.api('nope'),
    'prototype key': await s.api('constructor'),
    'too big': await s.api('call', JSON.stringify({ x: 'a'.repeat(MAX_JSON_BYTES) })),
  };
  const expect = { 'no cookie': 403, 'no Origin': 403, 'another site': 403, 'null origin': 403, 'another port': 403, 'cross-site fetch': 403, 'same-site fetch': 403, 'a form post': 415, 'text/plain': 415, GET: 405, 'not JSON': 400, 'an array': 400, 'unknown route': 404, 'prototype key': 404, 'too big': 413 };
  // A body past the limit may be cut off before the answer arrives; that is a refusal too.
  for (const [k, r] of Object.entries(refused)) if (!(r.reset && k === 'too big')) assert.equal(r.status, expect[k], k);
  assert.equal(s.host.seen.length, n, 'none of them reached the studio');
  assert.equal((await s.api('call', {}, { 'sec-fetch-site': 'same-origin' })).status, 200);
});

test('the API key goes in but never comes back out', async (t) => {
  const s = await started();
  t.after(() => s.srv.close());
  await s.api('key/set', { key: 'sk-ant-api03-test' });
  assert.deepEqual(s.host.seen.at(-1), ['keySet', 'sk-ant-api03-test']);
  assert.doesNotMatch((await s.api('key/status')).text, /sk-ant/);
});

test('the event stream needs the cookie and replays notices from before the page opened', async (t) => {
  const s = await started();
  t.after(() => s.srv.close());
  s.srv.emit({ kind: 'notice', message: '2 drafts came due' });
  assert.equal((await req(s.port, { path: '/api/events' })).status, 403);
  const got = await new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port: s.port, path: '/api/events', headers: { host: `127.0.0.1:${s.port}`, cookie: s.cookie } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; if (buf.includes('came due')) { r.destroy(); resolve({ status: res.statusCode, type: res.headers['content-type'], buf }); } });
    });
    r.on('error', reject);
  });
  assert.equal(got.status, 200);
  assert.match(got.type, /text\/event-stream/);
  assert.match(got.buf, /data: \{"kind":"notice","message":"2 drafts came due"\}/);
});

test('an upload goes to a random temporary name; the file name is only shown, never a path', async (t) => {
  const s = await started();
  t.after(() => s.srv.close());
  const up = (name, body, headers = {}) => req(s.port, { method: 'POST', path: '/api/kit/add', headers: { cookie: s.cookie, origin: s.origin, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name), ...headers }, body });
  const r = await up('../../../etc/evil.md', Buffer.from('# Brand\nHello'));
  assert.equal(r.status, 200);
  const [, files] = s.host.seen.at(-1);
  assert.equal(files.length, 1);
  const f = files[0];
  assert.equal(f.name, '../../../etc/evil.md', 'passed on for display only');
  assert.ok(f.path.startsWith(path.join(os.tmpdir(), 'fishbowl-upload-')), f.path);
  assert.match(path.basename(f.path), /^[0-9a-f]{24}$/);
  assert.doesNotMatch(f.path, /evil|etc/);
  assert.equal(f.existed, true);
  assert.equal(f.bytes, 13);
  assert.equal(fs.existsSync(f.path), false, 'removed once the studio has it');

  assert.equal((await up('a.md', 'x', { 'content-type': 'multipart/form-data; boundary=x' })).status, 415);
  assert.equal((await up('a.md', 'x', { origin: 'https://evil.example' })).status, 403);
  const n = s.host.seen.length;
  const big = await up('big.pdf', Buffer.alloc(MAX_UPLOAD_BYTES + 1));
  if (!big.reset) {
    assert.equal(big.status, 413);
    assert.match(big.json.results[0].reason, /Too big/);
  }
  assert.equal(s.host.seen.length, n, 'too big never reaches the studio');
});

test('an upload with no declared size is cut off at the limit and its temporary file removed', async (t) => {
  const s = await started();
  t.after(() => s.srv.close());
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('fishbowl-upload-')));
  const chunk = Buffer.alloc(1024 * 1024);
  const chunks = Array.from({ length: Math.ceil(MAX_UPLOAD_BYTES / chunk.length) + 2 }, () => chunk);
  const r = await req(s.port, { method: 'POST', path: '/api/kit/add', headers: { cookie: s.cookie, origin: s.origin, 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked', 'x-file-name': 'big.png' }, chunks });
  assert.ok(r.reset || r.status === 413, String(r.status));
  await new Promise((ok) => setTimeout(ok, 50));
  const left = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('fishbowl-upload-') && !before.has(f));
  assert.deepEqual(left, []);
  assert.ok(!s.host.seen.some(([k]) => k === 'kitAdd'));
});

test('an upload through the real studio lands in the brand kit under its shown name', async (t) => {
  const { host } = await app();
  const s = await started({ host });
  t.after(() => s.srv.close());
  const r = await req(s.port, { method: 'POST', path: '/api/kit/add', headers: { cookie: s.cookie, origin: s.origin, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('../Brand guide.md') }, body: '# Northwind\nWe fix bikes.' });
  assert.equal(r.status, 200);
  assert.equal(r.json.results[0].ok, true, JSON.stringify(r.json));
  const list = (await s.api('kit/list')).json;
  assert.equal(list.files.length, 1);
  assert.doesNotMatch(JSON.stringify(list), /\.\.\//);
});

test('a second copy gets a new link through the control secret, and nothing else does', async (t) => {
  const s = await started();
  t.after(() => s.srv.close());
  const ctl = (headers) => req(s.port, { method: 'POST', path: '/control/launch', headers });
  assert.equal((await ctl({})).status, 403);
  assert.equal((await ctl({ 'x-control': 'guess' })).status, 403);
  assert.equal((await ctl({ 'x-control': s.srv.control, origin: s.origin })).status, 403, 'never from a page');
  assert.equal((await req(s.port, { path: '/control/launch', headers: { 'x-control': s.srv.control } })).status, 403, 'POST only');
  const r = await ctl({ 'x-control': s.srv.control });
  assert.equal(r.status, 200);
  const url = new URL(r.json.url);
  assert.equal(url.origin, s.origin);
  assert.equal((await req(s.port, { path: `/${url.search}` })).status, 303);
});
