#!/usr/bin/env node
// Dev harness: spawns the real MCP server over stdio and serves a local host page that iframes
// the board and plays the host side of the MCP Apps bridge. `npm run dev`, then open
// http://localhost:7611. Uses dev/.demo-home (seeded on first run, or with --reseed).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seed, DEMO_HOME } from './seed.mjs';

const DEV = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 7611);
const home = process.env.STUDIO_HOME ? path.resolve(process.env.STUDIO_HOME) : DEMO_HOME;
if (process.argv.includes('--reseed') || !fs.existsSync(path.join(home, 'settings.json'))) {
  seed(home);
  console.log(`Seeded demo data in ${home}`);
}

const child = spawn(process.execPath, [path.join(DEV, '..', 'server', 'index.js')], { env: { ...process.env, STUDIO_HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] });
child.on('exit', (code) => { console.error(`MCP server exited (${code})`); process.exit(1); });

let nextId = 1, buf = '';
const waiting = new Map();
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    try { const m = JSON.parse(line); const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); } } catch {}
  }
});

// Forward one JSON-RPC request to the server with our own id; hand back its response.
function rpc(method, params) {
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } }, clientInfo: { name: 'studio-dev-host', version: '0.1.0' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(DEV, 'host.html')));
    }
    if (req.method === 'POST' && req.url === '/rpc') {
      let body = '';
      for await (const c of req) body += c;
      const { method, params } = JSON.parse(body);
      if (!['tools/call', 'tools/list', 'resources/read', 'resources/list'].includes(method)) { res.writeHead(400); return res.end('method not allowed'); }
      const out = await rpc(method, params);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(out));
    }
    if (req.method === 'POST' && req.url === '/reseed') {
      seed(home);
      res.writeHead(200); return res.end('ok');
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    res.writeHead(500); res.end(String(e.message || e));
  }
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is busy. Try PORT=7612 npm run dev.` : `Couldn't open port ${PORT}: ${e.message}`);
  child.kill(); process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => console.log(`Fishbowl Studio dev host: http://localhost:${PORT}  (data: ${home})`));
