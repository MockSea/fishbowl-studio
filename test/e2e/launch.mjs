// Raw HTTP checks of the local server's front door, with no browser: the one-time link, the
// session cookie, the Host and Origin rules, the API's method and body rules, the page's
// security headers, the launch control route and the address the port is bound to.
//   STUDIO_E2E=1 node launch.mjs [source|standalone]
// Writes docs/qa/web-0.1.0/shots/<mode>-launch-results.json.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';

if (!L.enabled()) { console.log('Set STUDIO_E2E=1 to run the launch checks.'); process.exit(0); }
const mode = process.argv[2] || 'source';
const results = [];
const check = (area, name, ok, detail = '') => { detail = String(detail).replace(/t=[0-9a-f]{64}/g, 't=<token>'); results.push({ area, name, ok: !!ok, detail: detail.slice(0, 600) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${area}: ${name}${detail ? `  [${String(detail).slice(0, 160)}]` : ''}`); };

// One request with exactly these headers (Node's fetch would add its own).
function req(port, { method = 'GET', pathname = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body !== null) r.write(body);
    r.end();
  });
}

const dirs = L.tempDirs(`${mode}-launch`);
const s = await L.startStudio({ mode, dirs, claude: 'none' });
try {
  const u = new URL(s.url);
  const port = Number(u.port);
  const token = u.searchParams.get('t');
  const origin = `http://127.0.0.1:${port}`;
  check('Launch link', 'the printed link is http://127.0.0.1 with a 64-hex token', u.hostname === '127.0.0.1' && /^[0-9a-f]{64}$/.test(token || ''), u.origin);

  // Port bound to the loopback address only.
  let listen = '';
  try { listen = execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }); } catch (e) { listen = String(e.stdout || ''); }
  check('Network', 'the port listens on 127.0.0.1 only', /127\.0\.0\.1:\d+ \(LISTEN\)/.test(listen) && !/\*:\d+ \(LISTEN\)/.test(listen), listen.trim().split('\n').slice(1).map((l) => l.replace(/^\S+\s+\d+\s+\S+/, '')).join(' | '));
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  if (lan) {
    const reached = await new Promise((r) => { const q = http.get({ host: lan.address, port, timeout: 2000 }, () => r(true)); q.on('error', () => r(false)); q.on('timeout', () => { q.destroy(); r(false); }); });
    check('Network', 'the port does not answer on the LAN address', !reached, reached ? 'answered' : 'refused');
  }

  // Front door without the token.
  let r = await req(port);
  check('Launch link', 'the page without a token or cookie is refused with the "open it from its link" page', r.status === 403 && /Open the studio from its link/.test(r.body), r.status);
  r = await req(port, { pathname: '/?t=' + '0'.repeat(64) });
  check('Launch link', 'a made-up token is refused', r.status === 403, r.status);
  r = await req(port, { pathname: `/?t=${token}`, headers: { host: `evil.example:${port}` } });
  check('Host', 'a request with a foreign Host (DNS rebinding) gets 421 and does not use up the token', r.status === 421, r.status);

  // The token, once.
  r = await req(port, { pathname: `/?t=${token}` });
  const setCookie = String(r.headers['set-cookie'] || '');
  check('Launch link', 'the token redirects to / and sets the session cookie', r.status === 303 && r.headers.location === '/' && setCookie.startsWith(`fishbowl_${port}=`), `${r.status} ${r.headers.location}`);
  check('Cookie', 'the cookie is HttpOnly, SameSite=Strict and Path=/', /HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie) && /Path=\//.test(setCookie), setCookie.replace(/=[0-9a-f]{20,}/, '=<session>'));
  check('Cookie', 'the cookie has no Expires or Max-Age (gone when the browser closes)', !/Expires|Max-Age/i.test(setCookie), '');
  const cookie = setCookie.split(';')[0];
  r = await req(port, { pathname: `/?t=${token}` });
  check('Launch link', 'the same token a second time is refused', r.status === 403, r.status);

  // The page with the cookie.
  r = await req(port, { headers: { cookie } });
  const csp = String(r.headers['content-security-policy'] || '');
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  const scripts = [...r.body.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  check('Page', 'the page loads with the cookie', r.status === 200 && /Fishbowl Studio/.test(r.body), r.status);
  check('Page', 'CSP allows scripts only by nonce, and every script tag carries it', !!nonce && scripts.length > 0 && scripts.every((t) => t.includes(`nonce="${nonce}"`)) && !/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp), `${scripts.length} scripts; ${csp}`);
  check('Page', 'CSP blocks framing, forms and outside connections', /frame-ancestors 'none'/.test(csp) && /form-action 'none'/.test(csp) && /connect-src 'self'/.test(csp) && /default-src 'none'/.test(csp), '');
  check('Page', 'nosniff, no-referrer, no-store and DENY framing headers are set', r.headers['x-content-type-options'] === 'nosniff' && r.headers['referrer-policy'] === 'no-referrer' && r.headers['cache-control'] === 'no-store' && r.headers['x-frame-options'] === 'DENY', '');
  const r2 = await req(port, { headers: { cookie } });
  const nonce2 = String(r2.headers['content-security-policy'] || '').match(/'nonce-([^']+)'/)?.[1];
  check('Page', 'the nonce changes on every load', nonce && nonce2 && nonce !== nonce2, '');

  // The API rules.
  const json = JSON.stringify({});
  const api = (pathname, headers = {}, method = 'POST', body = json) => req(port, { method, pathname, headers: { cookie, origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers }, body: method === 'GET' ? null : body });
  r = await api('/api/key/status');
  check('API', 'a same-origin JSON POST with the cookie works', r.status === 200, `${r.status} ${r.body.slice(0, 80)}`);
  r = await req(port, { method: 'POST', pathname: '/api/key/status', headers: { origin, 'content-type': 'application/json' }, body: json });
  check('API', 'no cookie: 403', r.status === 403, r.status);
  r = await api('/api/key/status', { cookie: `fishbowl_${port}=${'a'.repeat(64)}` });
  check('API', 'a made-up session cookie: 403', r.status === 403, r.status);
  r = await api('/api/key/status', { origin: 'https://evil.example' });
  check('API', 'a foreign Origin: 403', r.status === 403, r.status);
  r = await api('/api/key/status', { origin: '' });
  check('API', 'no Origin: 403', r.status === 403, r.status);
  r = await api('/api/key/status', { 'sec-fetch-site': 'cross-site' });
  check('API', 'Sec-Fetch-Site cross-site: 403', r.status === 403, r.status);
  r = await api('/api/key/status', { host: `evil.example:${port}` });
  check('API', 'a foreign Host: 421', r.status === 421, r.status);
  r = await api('/api/key/status', {}, 'GET');
  check('API', 'GET on an API route: 405', r.status === 405, r.status);
  r = await api('/api/key/status', { 'content-type': 'text/plain' });
  check('API', 'a text/plain body (what a cross-site form can send): 415', r.status === 415, r.status);
  r = await api('/api/key/status', {}, 'POST', 'not json');
  check('API', 'a body that is not JSON: 400', r.status === 400, r.status);
  r = await api('/api/key/status', {}, 'POST', '[1]');
  check('API', 'a JSON array body: 400', r.status === 400, r.status);
  r = await api('/api/nope');
  check('API', 'an unknown route: 404', r.status === 404, r.status);
  r = await api('/api/call', {}, 'POST', JSON.stringify({ name: 'studio_board', args: {} }));
  check('API', 'a tool call answers', r.status === 200, r.status);
  r = await api('/api/key/status', {}, 'POST', JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 10) })).catch((e) => ({ status: e.code || e.message }));
  check('API', 'a JSON body over 1 MB is refused (413, or the connection closed)', r.status === 413 || /hang up|ECONNRESET|EPIPE/.test(String(r.status)), r.status);
  r = await api('/api/key/status');
  check('API', 'the server still answers after the oversized body', r.status === 200, r.status);
  r = await api('/api/kit/add', { 'content-type': 'application/json', 'x-file-name': 'a.md' }, 'POST', '# hi');
  check('Kit upload', 'an upload that is not octet-stream: 415', r.status === 415, r.status);
  r = await api('/api/kit/add', { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('../../escape.md') }, 'POST', '# escape\n');
  const escaped = fs.existsSync(path.join(dirs.home, 'escape.md')) || fs.existsSync(path.join(dirs.base, 'escape.md')) || fs.existsSync(path.join(dirs.home, 'personas', 'escape.md'));
  check('Kit upload', 'a file name with ../ never writes outside the kit folder', !escaped, `${r.status} ${r.body.slice(0, 160)}`);
  r = await api('/api/events', {}, 'POST');
  check('API', 'POST on the event stream: 405', r.status === 405, r.status);

  // The launch control route (what a second `fishbowl-studio` uses to ask for a new link).
  r = await req(port, { method: 'POST', pathname: '/control/launch' });
  check('Control', '/control/launch without a proof is refused', r.status === 403, r.status);
  r = await req(port, { method: 'POST', pathname: '/control/launch', headers: { origin } });
  check('Control', '/control/launch from a page (any Origin) is refused', r.status === 403, r.status);
  r = await req(port, { method: 'GET', pathname: '/control/launch' });
  check('Control', 'GET /control/launch is refused', r.status === 403, r.status);

  const lock = path.join(dirs.app, 'server.json');
  const st = fs.statSync(lock);
  check('Control', 'the lock file holding the control secret is mode 600', (st.mode & 0o777) === 0o600, (st.mode & 0o777).toString(8));

  // A second launch gets a fresh link that works once, and the first session still works.
  const again = await L.startStudio({ mode, dirs, claude: 'none' });
  const t2 = new URL(again.url).searchParams.get('t');
  r = await req(port, { pathname: `/?t=${t2}` });
  check('Second launch', 'a second launch prints a new link on the same port that signs in', new URL(again.url).port === String(port) && r.status === 303 && t2 !== token, `${again.text().trim().split('\n').pop()}`);
  r = await api('/api/key/status');
  check('Second launch', 'the first session cookie still works after a second launch', r.status === 200, r.status);
} catch (e) {
  check('Run', 'launch checks finished without a script error', false, e.stack);
} finally {
  await s.stop();
}
fs.mkdirSync(L.OUT, { recursive: true });
fs.writeFileSync(path.join(L.OUT, `${mode}-launch-results.json`), JSON.stringify({ mode, at: new Date().toISOString(), results }, null, 2) + '\n');
console.log(`\n${results.filter((x) => x.ok).length} passed, ${results.filter((x) => !x.ok).length} failed.`);
