#!/usr/bin/env node
// Screenshots of every board section at desktop and phone width, into dev/shots/.
// Reseeds a throwaway demo folder, starts the dev host (dev/serve.mjs) on PORT (default 7631),
// adds a brand-new persona partway through the setup wizard (first-run card and every wizard
// step), then drives headless Chrome.
// Usage: node dev/shots.mjs   (set CHROME=/path/to/chrome if it isn't found)
//        node dev/shots.mjs --readme   the cropped, sharp set the README shows, into docs/screenshots/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEV = path.dirname(fileURLToPath(import.meta.url));
const README = process.argv.includes('--readme');
const OUT = README ? path.join(DEV, '..', 'docs', 'screenshots') : path.join(DEV, 'shots');
const PORT = Number(process.env.PORT || 7631);
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-shots-'));
const WIDTHS = { desktop: [1280, 1800], phone: [390, 2600] };
const SECTIONS = ['drafts', 'sources', 'topics', 'schedule', 'settings', 'reads', 'coach', 'playbook'];

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
// A brand-new persona, waiting for Claude's setup drafts, for the first-run card and the wizard
// steps; Fernhollow (seeded) shows the review step. Then back to the populated one.
await rpc('studio_wizard', { action: 'create', name: 'Juniper Lane Books', link: 'https://juniper-lane-books.example.com/' });
await rpc('studio_wizard', { action: 'answer', answers: { audience: 'Neighbours who read, and the Thursday book club', tone: 'Bookish and warm, never twee', topics: 'new fiction, author events', off_limits: '' } });
await rpc('studio_wizard', { action: 'draft' });
await rpc('studio_personas', { action: 'switch', slug: 'northwind-bicycles' });

fs.mkdirSync(OUT, { recursive: true });
const shots = [];
for (const [kind, [w, hgt]] of Object.entries(WIDTHS)) {
  for (const view of SECTIONS) shots.push({ file: `${view}-${kind}.png`, q: `view=${view}`, w, hgt });
  shots.push({ file: `first-run-${kind}.png`, q: 'view=drafts&persona=juniper-lane-books', w, hgt });
  for (const step of ['brand', 'questions', 'drafting', 'posting', 'finish']) shots.push({ file: `wizard-${step}-${kind}.png`, q: `view=wizard&persona=juniper-lane-books${step === 'drafting' ? '' : `&step=${step}`}`, w, hgt });
  shots.push({ file: `wizard-new-${kind}.png`, q: 'view=wizard&new=1', w, hgt });
  shots.push({ file: `wizard-review-${kind}.png`, q: 'view=wizard&persona=fernhollow-bakery', w, hgt });
  shots.push({ file: `posting-${kind}.png`, q: 'view=drafts&tab=passed', w, hgt });
}
shots.push({ file: 'wizard-review-chat-width.png', q: 'view=wizard&persona=fernhollow-bakery', w: 760, hgt: 2400 });
shots.push({ file: 'settings-chat-width.png', q: 'view=settings', w: 760, hgt: 2400 });
shots.push({ file: 'drawer-phone.png', q: 'view=drafts&drawer=1', w: 390, hgt: 1200 });
shots.push({ file: 'drafts-chat-width.png', q: 'view=drafts', w: 760, hgt: 1800 });

// The README set: one viewport each, at 2x so text stays sharp when GitHub scales it down.
// The demo's alert banners are hidden unless a shot is about them.
const README_SHOTS = [
  { file: 'drafts.png', q: 'view=drafts', w: 1280, hgt: 860 },
  { file: 'pick-one.png', q: 'view=drafts', w: 1280, hgt: 760, scroll: '.post.set' },
  { file: 'wizard.png', q: 'view=wizard&persona=fernhollow-bakery', w: 1280, hgt: 900 },
  { file: 'sources.png', q: 'view=sources', w: 1280, hgt: 900 },
  { file: 'topics.png', q: 'view=topics', w: 1280, hgt: 900 },
  { file: 'coach.png', q: 'view=coach', w: 1280, hgt: 900 },
  { file: 'accounts.png', q: 'view=settings', w: 1280, hgt: 760, scroll: 'section.card:has(.acct)' },
  { file: 'approved.png', q: 'view=drafts&tab=passed', w: 1280, hgt: 860, hide: '#jobs' },
  { file: 'phone-drafts.png', q: 'view=drafts', w: 390, hgt: 844 },
  { file: 'phone-menu.png', q: 'view=drafts&drawer=1', w: 390, hgt: 844 },
];
if (README) shots.splice(0, shots.length, ...README_SHOTS.map((r) => ({ hide: '#jobs, #posting', ...r })));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-chrome-'));
try {
  for (const s of shots) {
    const url = `http://localhost:${PORT}/?bare=1&width=${s.w}&${s.q}${README ? `&viewport=${s.hgt}` : ''}${s.scroll ? `&scroll=${encodeURIComponent(s.scroll)}` : ''}${s.hide ? `&hide=${encodeURIComponent(s.hide)}` : ''}`;
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', ...(README ? ['--force-device-scale-factor=2'] : []), `--user-data-dir=${profile}`, `--window-size=${s.w},${s.hgt}`, '--virtual-time-budget=6000', `--screenshot=${path.join(OUT, s.file)}`, url], { stdio: 'ignore' });
    console.log(path.relative(process.cwd(), path.join(OUT, s.file)));
  }
} finally {
  server.kill();
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.rmSync(profile, { recursive: true, force: true });
}
