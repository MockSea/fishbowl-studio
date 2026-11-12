// Shared helpers for the web QA scripts: starting the studio (from source, through npx or as the
// standalone binary) with a throwaway data folder, opening its one-time link in a headless
// Chrome, screenshots, and adding brand kit files the way a drag and drop does.
// playwright-core is imported lazily so `npm test` at the repo root, which also loads files
// under test/, never needs it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const DOCS = path.resolve(process.env.QA_DOCS || path.join(ROOT, 'docs', 'qa', 'web-0.1.0'));
export const OUT = path.join(DOCS, 'shots');
export const STANDALONE = process.env.QA_STANDALONE || path.join(ROOT, 'dist', `fishbowl-studio-${process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`);
// What `npx github:...` runs. Default: the commit under test, since the documented tag may point
// somewhere else (the report says which).
export const NPX_SPEC = process.env.QA_NPX_SPEC || 'github:MockSea/fishbowl-studio#77acfe486ecabd5cb606bac5a73f4adb2628a728';
export const CHROME = process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// A plain system PATH: no node, no claude.
export const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const REAL_CLAUDE = process.env.QA_CLAUDE || path.join(os.homedir(), '.local', 'bin', 'claude');

export const enabled = () => process.env.STUDIO_E2E === '1';

// Strips what is particular to this machine and run from text the walk keeps: the per-user
// temp root (and the os.tmpdir() spelling of it) and link tokens.
const TMP_ROOTS = [...new Set([fs.realpathSync(os.tmpdir()), os.tmpdir()])].map((r) => r.replace(/\/+$/, ''));
export function scrub(text) {
  let out = String(text).replace(/t=[0-9a-f]{64}/g, 't=<token>');
  for (const r of TMP_ROOTS) out = out.split(r).join('<tmp>');
  return out;
}

export function tempDirs(label) {
  // The real path: on macOS os.tmpdir() runs through the /var symlink, and npm 11 then builds
  // the git package without its bundled dependencies (see the report's W6).
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `studio-web-e2e-${label}-`));
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  return { base, home, app: path.join(home, 'app') };
}

// A bin folder for PATH. claude: 'real' (a link to the installed Claude Code), 'broken' (a
// claude that always fails, as a signed-out one would), or 'none'. node: link node, npm, npx.
export function binDir(base, { claude = 'none', node = false } = {}) {
  const dir = path.join(base, `bin-${claude}${node ? '-node' : ''}`);
  if (fs.existsSync(dir)) return dir;
  fs.mkdirSync(dir, { recursive: true });
  if (claude === 'real') fs.symlinkSync(REAL_CLAUDE, path.join(dir, 'claude'));
  if (claude === 'broken') {
    fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\necho "Invalid API key. Please run /login" >&2\nexit 1\n', { mode: 0o755 });
  }
  if (node) {
    const nodeDir = path.dirname(process.execPath);
    for (const n of ['node', 'npm', 'npx']) {
      const src = path.join(nodeDir, n);
      if (fs.existsSync(src)) fs.symlinkSync(fs.realpathSync(src), path.join(dir, n));
    }
  }
  return dir;
}

// Starts the studio and waits for its link. mode: source | npx | standalone. claude picks what
// is on PATH. Returns { url, out, proc, stop() }.
export async function startStudio({ mode, dirs, env = {}, args = [], claude = 'none', npmCache }) {
  const base = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'STUDIO_HOME', 'STUDIO_ANTHROPIC_BASE_URL', 'STUDIO_MODEL']) delete base[k];
  let cmd, argv;
  const needsNode = mode === 'npx';
  const PATH = [binDir(dirs.base, { claude, node: needsNode }), SYSTEM_PATH].join(':');
  if (mode === 'standalone') {
    if (!fs.existsSync(STANDALONE)) throw new Error(`No standalone build at ${STANDALONE}. Run npm run build:standalone.`);
    cmd = STANDALONE; argv = [];
  } else if (mode === 'npx') {
    cmd = path.join(binDir(dirs.base, { claude, node: true }), 'npx'); argv = ['--yes', NPX_SPEC];
  } else {
    cmd = process.execPath; argv = [path.join(ROOT, 'bin', 'fishbowl-studio.js')];
  }
  const fullEnv = { ...base, PATH, ...(npmCache ? { npm_config_cache: npmCache } : {}), ...env };
  const proc = spawn(cmd, [...argv, '--no-open', '--home', dirs.home, ...args], { cwd: dirs.base, env: fullEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = [];
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No link after 180 s. Output:\n${out.join('')}`)), 180000);
    const read = (d) => {
      out.push(String(d));
      const m = out.join('').match(/(?:Open it here \(the link works once\)|already running\. Opening it): (http:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    };
    proc.stdout.on('data', read);
    proc.stderr.on('data', (d) => out.push(String(d)));
    proc.on('exit', (code) => { clearTimeout(timer); const m = out.join('').match(/Opening it: (http:\/\/\S+)/); if (m) resolve(m[1]); else reject(new Error(`Exited ${code} before a link. Output:\n${out.join('')}`)); });
  });
  const stop = async (signal = 'SIGINT') => {
    if (proc.exitCode !== null || proc.signalCode) return proc.exitCode;
    const done = new Promise((r) => proc.once('exit', (c, s) => r(c ?? s)));
    try { process.kill(-proc.pid, signal); } catch { /* gone */ }
    const t = setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } }, 10000);
    const code = await done;
    clearTimeout(t);
    return code;
  };
  return { url, out, proc, stop, text: () => out.join('') };
}

let browser = null;
export async function getBrowser() {
  if (browser) return browser;
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  return browser;
}
export async function closeBrowser() { if (browser) { await browser.close().catch(() => {}); browser = null; } }

// Opens a launch link in a new browser context (its own cookies), like a fresh browser tab.
export async function openStudio(url, { width = 1280, height = 800 } = {}) {
  const b = await getBrowser();
  const context = await b.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  await page.waitForSelector('.navbtn', { timeout: 30000 });
  await settle(page, 1200);
  await watchFlash(page);
  return { context, page, logs };
}

export async function settle(page, ms = 600) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(ms);
}

export function shooter(prefix) {
  fs.mkdirSync(OUT, { recursive: true });
  const taken = [];
  return {
    taken,
    async shot(page, name, opts = {}) {
      const file = path.join(OUT, `${prefix}-${name}.png`);
      await page.screenshot({ path: file, fullPage: !!opts.full, scale: 'css' });
      taken.push(path.relative(OUT, file));
      return file;
    },
  };
}

export async function nav(page, view) {
  await page.click(`.navbtn[data-view="${view}"]`);
  await settle(page);
}

// Every message the board flashes, in order, since the last call (the banner lasts a few seconds
// and run progress replaces it, so a single read can miss one).
export async function watchFlash(page) {
  await page.evaluate(() => {
    if (window.__qaFlash) return;
    window.__qaFlash = [];
    const el = document.getElementById('flash');
    const note = () => { if (!el.hidden && el.textContent.trim()) window.__qaFlash.push(el.textContent.trim()); };
    new MutationObserver(note).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  });
}
export async function flashes(page, { wait = 0 } = {}) {
  if (wait) await page.waitForTimeout(wait);
  return page.evaluate(() => { const a = [...new Set(window.__qaFlash || [])]; window.__qaFlash = []; return a; });
}
export async function waitFlash(page, re, timeout = 30000) {
  const seen = [];
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    seen.push(...(await flashes(page)));
    if (seen.some((t) => re.test(t))) return seen;
    await page.waitForTimeout(250);
  }
  return seen;
}

// A real drop of files from disk onto the Brand kit drop zone, through Chromium's own drag
// events, so the page gets File objects (what Finder hands a browser).
export async function dropFiles(page, files) {
  const box = await page.locator('.drop').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: files.map((f) => path.resolve(f)), dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x, y, data });
  await cdp.detach();
  await page.waitForTimeout(2500);
}

// The Choose files button opens the browser's file picker; hand it these files.
export async function chooseFiles(page, files) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.click('button:has-text("Choose files")')]);
  await chooser.setFiles(files.map((f) => path.resolve(f)));
  await page.waitForTimeout(2500);
}

export function writeLog(name, lines) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.log`), (Array.isArray(lines) ? lines.join('\n') : String(lines)) + '\n');
}

// Today's date in local time, the way the daily cap counts it.
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
