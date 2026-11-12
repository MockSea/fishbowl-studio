// Shared helpers for the desktop QA scripts: launching the app (from source or from the built
// .app), a throwaway data folder per run, screenshots, and adding brand kit files the way a
// drag and drop does. playwright-core is imported lazily so `npm test` at the repo root, which
// also loads files under test/, never needs it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const OUT = path.resolve(process.env.QA_OUT || path.join(ROOT, 'docs', 'qa', 'electron-0.1.0', 'shots'));
export const FIX = path.join(HERE, 'fixtures');
export const BUILT_APP = process.env.QA_APP || path.join(ROOT, 'dist', `mac-${process.arch}`, 'Fishbowl Studio.app');
// What a Dock or Finder launch gets: launchd's PATH, with no node on it.
export const FINDER_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

export const enabled = () => process.env.STUDIO_E2E === '1';

export function tempDirs(label) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `studio-e2e-${label}-`));
  const home = path.join(base, 'home'), app = path.join(base, 'app');
  fs.mkdirSync(home); fs.mkdirSync(app);
  return { base, home, app };
}

// mode: 'source' runs node_modules/electron against the repo, like `npm run desktop`.
// mode: 'built' runs the packaged .app's binary with a Finder-like PATH.
export async function launch({ mode = 'source', dirs, env = {}, args = [] } = {}) {
  const { _electron } = await import('playwright-core');
  const require = createRequire(path.join(ROOT, 'package.json'));
  const base = { ...process.env, STUDIO_HOME: dirs.home, STUDIO_APP_DIR: dirs.app, ...env };
  delete base.ELECTRON_RUN_AS_NODE;
  let opts;
  if (mode === 'built') {
    const exe = path.join(BUILT_APP, 'Contents', 'MacOS', 'Fishbowl Studio');
    if (!fs.existsSync(exe)) throw new Error(`No built app at ${BUILT_APP}. Run npm run make first.`);
    opts = { executablePath: exe, args, env: { ...base, PATH: FINDER_PATH } };
  } else {
    opts = { executablePath: require('electron'), args: [ROOT, ...args], cwd: ROOT, env: base };
  }
  const app = await _electron.launch({ ...opts, timeout: 60000 });
  const page = await app.firstWindow();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.navbtn', { timeout: 30000 });
  await settle(page);
  await watchFlash(page);
  return { app, page, logs };
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

// Every message the board flashes, in order, since the last call (the banner lasts six seconds
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
  const all = await page.evaluate(() => { const a = [...new Set(window.__qaFlash || [])]; window.__qaFlash = []; return a; });
  return all;
}
// Wait until a flash matching re shows up (or timeout); returns every flash seen meanwhile.
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
// events, so the page gets File objects with paths (what Finder hands it).
export async function dropFiles(page, files) {
  const box = await page.locator('.drop').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: files.map((f) => path.resolve(f)), dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x, y, data });
  await cdp.detach();
  await page.waitForTimeout(2500);
}

// Make the native Open dialog return these paths, so the Choose files button can be driven.
export async function stubOpenDialog(app, files) {
  await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, files.map((f) => path.resolve(f)));
}

export async function close(app) {
  try { await app.close(); } catch { /* already gone */ }
}

export function writeLog(name, lines) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.log`), lines.join('\n') + '\n');
}
