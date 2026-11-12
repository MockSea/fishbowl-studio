// Stand-ins for the Anthropic API, so no real key is needed.
//   startMock(): the repo's dev/mock-anthropic.mjs, which answers every brief with canned JSON.
//   startRefusing(status): answers every request with an API error (401 = bad key).
// A closed port (DEAD_URL) stands in for no network.
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './lib.mjs';

export const DEAD_URL = 'http://127.0.0.1:9';

export async function startMock(port = 18787) {
  const child = spawn(process.execPath, [path.join(ROOT, 'dev', 'mock-anthropic.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = [];
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { lines.push(...String(d).trim().split('\n')); if (/mock Anthropic API/.test(String(d))) resolve(); });
    child.on('exit', () => reject(new Error('mock exited')));
  });
  return { url: `http://127.0.0.1:${port}`, lines, stop: () => child.kill() };
}

export async function startRefusing(status = 401, port = 18788) {
  const seen = [];
  const type = { 401: 'authentication_error', 403: 'permission_error', 429: 'rate_limit_error', 500: 'api_error' }[status] || 'api_error';
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['x-api-key'] ? 'present' : req.headers.authorization ? 'authorization' : 'missing', headers: Object.keys(req.headers).sort().join(','), bytes: body.length });
      res.writeHead(status, { 'content-type': 'application/json', 'request-id': 'req_qa' });
      res.end(JSON.stringify({ type: 'error', error: { type, message: 'invalid x-api-key' } }));
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${port}`, seen, stop: () => server.close() };
}
