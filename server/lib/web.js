// The local web server: the board page and a small JSON API over host.js, for one person on
// this computer.
//
// What keeps other people and other web pages out:
//   - It listens on 127.0.0.1 only.
//   - The page needs a session cookie. The only way to get one is a launch link with a one-time
//     token (printed in the terminal and opened in the browser). A token works once, within
//     TOKEN_TTL_MS, and is swapped for an HttpOnly, SameSite=Strict cookie.
//   - Every request must carry a Host of 127.0.0.1:<port> or localhost:<port> (stops DNS
//     rebinding). No CORS headers are ever sent.
//   - Anything that changes state is a POST with the cookie, a same-origin Origin header and a
//     JSON (or, for uploads, octet-stream) body. GET only serves the page and the event stream.
//   - An uploaded file is written to a fresh temporary file with a random name. The name the
//     person's file had is only shown; it never becomes a path.
// A second copy of the command asks this one, through a control secret in the app folder, for a
// new launch link instead of starting another server.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { boardHtml } from './page.js';
import { LIMITS } from './brandkit.js';

export const TOKEN_TTL_MS = 5 * 60 * 1000;
export const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_UPLOAD_BYTES = Math.max(LIMITS.file_bytes, LIMITS.image_bytes);
const HEARTBEAT_MS = 25 * 1000;
const CSP = (nonce) => `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`;
const HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

const secret = () => randomBytes(32).toString('hex');
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...HEADERS, 'content-type': type, 'content-length': Buffer.byteLength(data), ...extra });
  res.end(data);
}
const deny = (res, status, message) => send(res, status, { error: message });

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(Object.assign(new Error('Too big.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Streams an upload to a new private temporary folder, stopping past `limit` bytes.
function saveUpload(req, limit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fishbowl-upload-'));
  const file = path.join(dir, randomBytes(12).toString('hex'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file, { mode: 0o600 });
    let n = 0, failed = false;
    const fail = (e) => { if (failed) return; failed = true; out.destroy(); req.destroy(); cleanup(); reject(e); };
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) fail(Object.assign(new Error(`Too big: files can be up to ${Math.round(limit / 1048576)} MB.`), { status: 413 }));
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => { if (!failed) resolve({ file, cleanup }); });
    req.pipe(out);
  });
}

// host: makeHost(). port 0 picks a free one. page() builds the board HTML.
export function makeServer({ host, port = 0, page = () => boardHtml(), now = () => Date.now(), control = secret() }) {
  const session = secret();
  const tokens = new Map(); // token -> expiry
  const streams = new Set();
  const backlog = []; // notices from before any page was connected
  let origin = null, cookieName = null, allowedHosts = [], allowedOrigins = [];

  function mintToken() {
    const t = secret();
    for (const [k, exp] of tokens) if (exp < now()) tokens.delete(k);
    tokens.set(t, now() + TOKEN_TTL_MS);
    return t;
  }
  const launchUrl = () => `${origin}/?t=${mintToken()}`;
  const signedIn = (req) => same(cookies(req)[cookieName] || '', session);

  // Run progress and notices to every open page.
  function emit(ev) {
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    if (!streams.size && ev.kind === 'notice') backlog.push(line);
    for (const res of streams) res.write(line);
  }

  // The page's API. Each takes the parsed JSON body.
  const api = {
    call: async (b) => {
      try { return await host.call(String(b.name || ''), b.args && typeof b.args === 'object' ? b.args : {}); }
      catch (e) { return { error: e.message }; }
    },
    ask: async (b) => { const r = host.ask(String(b.text || '')); return { ok: r.ok, kind: r.kind, message: r.message }; },
    'key/status': () => host.keyStatus(),
    'key/set': (b) => host.keySet(String(b.key || '')),
    'key/clear': () => host.keyClear(),
    'kit/list': () => host.kitList(),
    'kit/remove': (b) => host.kitRemove(String(b.id || '')),
    'prefs/get': () => host.prefsGet(),
    'prefs/set': (b) => host.prefsSet(b),
  };

  async function kitUpload(req, res) {
    if (!/^application\/octet-stream\b/i.test(String(req.headers['content-type'] || ''))) return deny(res, 415, 'Send the file as application/octet-stream.');
    let name = 'file';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')).slice(0, 255); } catch { /* keep the default */ }
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_UPLOAD_BYTES) return send(res, 413, { results: [{ ok: false, name, reason: `Too big: files can be up to ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB.` }], kit: host.kitList() });
    let up;
    try { up = await saveUpload(req, MAX_UPLOAD_BYTES); }
    catch (e) { return send(res, e.status || 400, { results: [{ ok: false, name, reason: e.status ? e.message : 'The upload didn\'t arrive.' }], kit: host.kitList() }); }
    try { return send(res, 200, await host.kitAdd([{ path: up.file, name }])); }
    finally { up.cleanup(); }
  }

  function events(req, res) {
    res.writeHead(200, { ...HEADERS, 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' });
    res.write(': hello\n\n');
    while (backlog.length) res.write(backlog.shift());
    streams.add(res);
    const beat = setInterval(() => res.write(': .\n\n'), HEARTBEAT_MS);
    req.on('close', () => { clearInterval(beat); streams.delete(res); });
  }

  function servePage(res) {
    const nonce = randomBytes(16).toString('base64');
    const html = page().replaceAll('<script>', `<script nonce="${nonce}">`);
    send(res, 200, html, 'text/html; charset=utf-8', { 'content-security-policy': CSP(nonce) });
  }

  async function handle(req, res) {
    if (!allowedHosts.includes(String(req.headers.host || '').toLowerCase())) return deny(res, 421, 'Wrong host.');
    const url = new URL(req.url, origin);

    // A second copy of the command asking for a fresh launch link.
    if (url.pathname === '/control/launch') {
      if (req.method !== 'POST' || req.headers.origin || !same(req.headers['x-control'] || '', control)) return deny(res, 403, 'Not allowed.');
      return send(res, 200, { url: launchUrl() });
    }

    if (url.pathname === '/' && req.method === 'GET') {
      const t = url.searchParams.get('t');
      if (t !== null) {
        const exp = tokens.get(t);
        tokens.delete(t);
        if (!exp || exp < now()) return send(res, 403, gone, 'text/html; charset=utf-8', { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
        return send(res, 303, '', 'text/plain', { location: '/', 'set-cookie': `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/` });
      }
      if (!signedIn(req)) return send(res, 403, gone, 'text/html; charset=utf-8', { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
      return servePage(res);
    }

    if (!url.pathname.startsWith('/api/')) return deny(res, 404, 'Not found.');
    if (!signedIn(req)) return deny(res, 403, 'Open the studio from the link the command printed.');
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') return deny(res, 403, 'Not allowed.');
    const name = url.pathname.slice(5);

    if (name === 'events') return req.method === 'GET' ? events(req, res) : deny(res, 405, 'GET only.');
    if (req.method !== 'POST') return deny(res, 405, 'POST only.');
    if (!allowedOrigins.includes(req.headers.origin)) return deny(res, 403, 'Not allowed.');
    if (name === 'kit/add') return kitUpload(req, res);
    if (!Object.hasOwn(api, name)) return deny(res, 404, 'Not found.');
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return deny(res, 415, 'Send JSON.');
    let body;
    try { body = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString('utf8') || '{}'); }
    catch (e) { return deny(res, e.status || 400, e.status ? 'Too big.' : 'That wasn\'t JSON.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return deny(res, 400, 'Send a JSON object.');
    return send(res, 200, (await api[name](body)) ?? null);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) deny(res, 500, 'Something went wrong in the studio.'); else res.end(); });
  });
  server.headersTimeout = 20000;
  server.requestTimeout = 0; // the event stream stays open

  return {
    emit, mintToken, launchUrl, control,
    get origin() { return origin; },
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          const p = server.address().port;
          origin = `http://127.0.0.1:${p}`;
          cookieName = `fishbowl_${p}`; // cookies don't keep ports apart; the name does
          allowedHosts = [`127.0.0.1:${p}`, `localhost:${p}`];
          allowedOrigins = allowedHosts.map((h) => `http://${h}`);
          resolve({ port: p, origin });
        });
      });
    },
    close() {
      for (const res of streams) res.end();
      streams.clear();
      return new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
    },
    server,
  };
}

const gone = `<!doctype html><meta charset="utf-8"><title>Fishbowl Studio</title>
<body style="font:16px system-ui,sans-serif;max-width:32em;margin:4em auto;padding:0 1em;line-height:1.5">
<h1 style="font-size:1.3em">Open the studio from its link</h1>
<p>Each link to the studio works once, so nobody else on this computer can open it. Run the command again and it opens a new one.</p>`;
