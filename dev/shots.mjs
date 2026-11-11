#!/usr/bin/env node
// Screenshots of every board section at desktop and phone width, into dev/shots/.
// Seeds a throwaway demo folder, starts the studio's own server on it (no browser, no engine),
// adds a brand-new persona partway through the setup wizard (first-run card and every wizard
// step), then drives headless Chrome through a fresh launch link for each shot.
// Usage: node dev/shots.mjs   (set CHROME=/path/to/chrome if it isn't found)
//        node dev/shots.mjs --readme   the cropped, sharp set the README shows, into docs/screenshots/
//        THEME=dark node dev/shots.mjs  the dark skin, into dev/shots/dark/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { seed } from './seed.mjs';
import { makeHost } from '../server/lib/host.js';
import { makeServer } from '../server/lib/web.js';
import { boardHtml } from '../server/lib/page.js';
import { readOwn } from '../server/lib/files.js';

const DEV = path.dirname(fileURLToPath(import.meta.url));
const README = process.argv.includes('--readme');
const THEME = process.env.THEME === 'dark' ? 'dark' : '';
const OUT = README ? path.join(DEV, '..', 'docs', 'screenshots') : path.join(DEV, 'shots', THEME);
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-shots-'));
const APP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-shots-app-'));
const WIDTHS = { desktop: [1280, 1800], phone: [390, 2600] };
const SECTIONS = ['drafts', 'brandkit', 'apikey', 'sources', 'topics', 'schedule', 'settings', 'reads', 'playbook'];

const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('No Chrome found. Set CHROME=/path/to/chrome.'); process.exit(1); }


// The shot being taken: which view to open first, then what to click, hide or scroll to.
let shot = {};
const STAGE = `(function () {
  const s = window.SHOT || {};
  if (s.theme) document.documentElement.dataset.skin = s.theme;
  // No event stream: headless Chrome's virtual time stands still while a request is open.
  window.Studio.connect = async () => ({});
  const call = window.Studio.callTool;
  let first = true;
  window.Studio.callTool = (name, args) => {
    if (first && name === 'studio_view') { first = false; args = Object.assign({}, args, s.args); }
    return call(name, args);
  };
  setTimeout(() => {
    if (s.drawer) { const b = document.getElementById('menu-btn'); if (b) b.click(); }
    if (s.hide) { const st = document.createElement('style'); st.textContent = s.hide + ' { display: none !important; }'; document.head.append(st); }
    if (s.scroll) setTimeout(() => { const el = document.querySelector(s.scroll); if (el) el.scrollIntoView({ block: 'start' }); }, 300);
  }, 300);
})();`;
const page = () => boardHtml({ bridgeSource: `window.SHOT = ${JSON.stringify(shot).replace(/</g, '\\u003c')};\n${readOwn('server/ui/web-bridge.js')}\n${STAGE}` });

seed(HOME);
// The board sends a person with no way to draft to the Claude page, so once the demo is set up the
// host reports Claude Code as installed. Nothing in a shot makes a model call.
let claude = null;
const host = makeHost({ home: HOME, appDir: APP, os: null, claudePath: () => claude });
const srv = makeServer({ host, page });
await srv.listen();

// A brand-new persona, waiting for Claude's setup drafts, for the first-run card and the wizard
// steps; Fernhollow (seeded) shows the review step. Then back to the populated one.
await host.call('studio_wizard', { action: 'create', name: 'Juniper Lane Books', link: 'https://juniper-lane-books.example.com/' });
await host.call('studio_wizard', { action: 'answer', answers: { audience: 'Neighbours who read, and the Thursday book club', tone: 'Bookish and warm, never twee', topics: 'new fiction, author events', off_limits: '' } });
await host.call('studio_wizard', { action: 'draft' });
await host.call('studio_personas', { action: 'switch', slug: 'northwind-bicycles' });
claude = '/nonexistent/claude';

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
  { file: 'brandkit.png', q: 'view=brandkit', w: 1280, hgt: 900 },
  { file: 'claude.png', q: 'view=apikey', w: 1280, hgt: 760 },
  { file: 'approved.png', q: 'view=drafts&tab=passed', w: 1280, hgt: 860, hide: '#jobs' },
  { file: 'phone-drafts.png', q: 'view=drafts', w: 390, hgt: 844 },
  { file: 'phone-menu.png', q: 'view=drafts&drawer=1', w: 390, hgt: 844 },
];
if (README) shots.splice(0, shots.length, ...README_SHOTS.map((r) => ({ hide: '#jobs, #posting', ...r })));


// q is the shot's address in the old dev host's query form: view, persona, step, tab, new, drawer.
function stage(sh) {
  const q = new URLSearchParams(sh.q);
  const args = { view: q.get('view') || 'drafts' };
  for (const k of ['persona', 'step', 'tab']) if (q.get(k)) args[k] = q.get(k);
  if (q.get('new')) args.new_persona = true;
  return { args, drawer: !!q.get('drawer'), hide: sh.hide || '', scroll: sh.scroll || '', theme: THEME };
}

const CHROME_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-chrome-'));
try {
  for (const sh of shots) {
    shot = stage(sh);
    // Async: the server answering Chrome runs in this same process.
    await promisify(execFile)(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', ...(README ? ['--force-device-scale-factor=2'] : []), `--user-data-dir=${CHROME_PROFILE}`, `--window-size=${sh.w},${sh.hgt}`, '--virtual-time-budget=6000', `--screenshot=${path.join(OUT, sh.file)}`, srv.launchUrl()], { timeout: 60000 });
    console.log(path.relative(process.cwd(), path.join(OUT, sh.file)));
  }
} finally {
  await srv.close();
  for (const d of [HOME, APP, CHROME_PROFILE]) fs.rmSync(d, { recursive: true, force: true });
}
