#!/usr/bin/env node
// Screenshots of every board section at desktop and phone width, into dev/shots/.
// Reseeds a throwaway demo folder, starts the dev host (dev/serve.mjs) on PORT (default 7631),
// adds a brand-new persona for the first-run screen, then drives headless Chrome.
// Usage: node dev/shots.mjs   (set CHROME=/path/to/chrome if it isn't found)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEV = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DEV, 'shots');
const PORT = Number(process.env.PORT || 7631);
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-shots-'));
const WIDTHS = { desktop: [1280, 1800], phone: [390, 2600] };
const SECTIONS = ['drafts', 'sources', 'topics', 'schedule', 'settings', 'reads', 'playbook'];

const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('No Chrome found. Set CHROME=/path/to/chrome.'); process.exit(1); }

const server = spawn(process.execPath, [path.join(DEV, 'serve.mjs'), '--reseed'], { env: { ...process.env, PORT: String(PORT), STUDIO_HOME: HOME }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => { if (/dev host:/.test(String(d))) resolve(); });
  server.on('exit', (c) => reject(new Error(`dev host exited (${c})`)));
});

const rpc = async (name, args) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'tools/call', params: { name, arguments: args } }) });
  return r.json();
};
// A brand-new persona for the first-run card, then back to the populated one.
await rpc('studio_personas', { action: 'create', name: 'Juniper Lane Books' });
await rpc('studio_personas', { action: 'switch', slug: 'northwind-bicycles' });

fs.mkdirSync(OUT, { recursive: true });
const shots = [];
for (const [kind, [w, hgt]] of Object.entries(WIDTHS)) {
  for (const view of SECTIONS) shots.push({ file: `${view}-${kind}.png`, q: `view=${view}`, w, hgt });
  shots.push({ file: `first-run-${kind}.png`, q: 'view=drafts&persona=juniper-lane-books', w, hgt });
}
shots.push({ file: 'drawer-phone.png', q: 'view=drafts&drawer=1', w: 390, hgt: 1200 });
shots.push({ file: 'drafts-chat-width.png', q: 'view=drafts', w: 760, hgt: 1800 });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-chrome-'));
try {
  for (const s of shots) {
    const url = `http://localhost:${PORT}/?bare=1&width=${s.w}&${s.q}`;
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${profile}`, `--window-size=${s.w},${s.hgt}`, '--virtual-time-budget=6000', `--screenshot=${path.join(OUT, s.file)}`, url], { stdio: 'ignore' });
    console.log(`dev/shots/${s.file}`);
  }
} finally {
  server.kill();
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.rmSync(profile, { recursive: true, force: true });
}
