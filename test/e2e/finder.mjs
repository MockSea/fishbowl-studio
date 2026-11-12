// Opens the built .app through LaunchServices (`open`), the same path a Finder or Dock
// double-click takes: launchd's environment, no shell, no node on PATH. The data folders are
// passed with `open --env` so the real ~/Documents/Fishbowl Studio is never touched, and a
// debugging port lets Playwright attach to the window that LaunchServices started.
//   STUDIO_E2E=1 node finder.mjs        (needs `npm run make` first)
// Screenshots go to docs/qa/<version>/shots/finder-*.png (or QA_OUT), checks to finder-results.json.
if (process.env.STUDIO_E2E !== '1') process.exit(0);

const fs = await import('node:fs');
const path = await import('node:path');
const os = await import('node:os');
const { execFileSync } = await import('node:child_process');
const { chromium } = await import('playwright-core');
const { tempDirs, settle, shooter, nav, watchFlash, waitFlash, dropFiles, OUT, BUILT_APP } = await import('./lib.mjs');
const { startMock } = await import('./api.mjs');
const { makeFixtures } = await import('./fixtures.mjs');

const PORT = 19229;
const { shot } = shooter('finder');
const dirs = tempDirs('finder');
const fx = makeFixtures(path.join(dirs.base, 'fixtures'));
const results = [];
const check = (area, name, ok, detail = '', s = null) => {
  results.push({ area, name, ok: !!ok, detail: String(detail).slice(0, 600), shot: s ? `finder-${s}.png` : null });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${name}${detail ? ` :: ${String(detail).slice(0, 200)}` : ''}`);
};
const text = (page) => page.evaluate(() => (document.querySelector('main') || document.body).innerText);

if (!fs.existsSync(BUILT_APP)) { console.error(`No built app at ${BUILT_APP}. Run npm run make first.`); process.exit(1); }
const mock = await startMock();

async function openApp() {
  execFileSync('open', ['-n', '--env', `STUDIO_HOME=${dirs.home}`, '--env', `STUDIO_APP_DIR=${dirs.app}`, '--env', `STUDIO_ANTHROPIC_BASE_URL=${mock.url}`,
    BUILT_APP, '--args', `--remote-debugging-port=${PORT}`]);
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => null);
    if (!browser) await new Promise((r) => setTimeout(r, 500));
  }
  if (!browser) throw new Error('The app opened by LaunchServices never answered on the debugging port.');
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('studio://'));
    if (!page) await new Promise((r) => setTimeout(r, 500));
  }
  await page.waitForSelector('.navbtn', { timeout: 30000 });
  await settle(page);
  await watchFlash(page);
  return { browser, page };
}
async function quitApp(browser) {
  // Command-Q equivalent: ask the app to quit, then wait for the process to go.
  try { execFileSync('osascript', ['-e', 'tell application id "' + appId() + '" to quit']); } catch { /* fall back below */ }
  await browser.close().catch(() => {});
  for (let i = 0; i < 40; i++) {
    if (!running()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}
const appId = () => execFileSync('defaults', ['read', path.join(BUILT_APP, 'Contents', 'Info'), 'CFBundleIdentifier']).toString().trim();
const running = () => { try { return execFileSync('pgrep', ['-f', `${BUILT_APP}/Contents/MacOS/`]).toString().trim(); } catch { return ''; } };

if (running()) { console.error('The built app is already running. Quit it first.'); process.exit(1); }

let { browser, page } = await openApp();
try {
  const pid = running().split('\n')[0];
  const envPath = execFileSync('ps', ['eww', '-o', 'command=', '-p', pid]).toString();
  const p = (envPath.match(/ PATH=(\S+)/) || [])[1] || '(not set)';
  check('Finder launch', 'started by LaunchServices with launchd\'s PATH (no node on it)', !/node|nvm|homebrew|\.volta/i.test(p), `PATH=${p.split(os.homedir()).join('~')}`);
  await shot(page, '01-first-run');
  check('Finder launch', 'opens on the API key page on first run', /Anthropic API key/.test(await text(page)), '', '01-first-run');
  check('Finder launch', 'uses the data folder it was given, not ~/Documents', (await page.innerText('body')).includes(path.basename(dirs.base)), '', '01-first-run');

  await page.fill('input[aria-label="Anthropic API key"]', 'sk-ant-qa-not-a-real-key-0000000000000000');
  await page.click('button:has-text("Save key")');
  const seen = await waitFlash(page, /Saved|keychain|encrypt/i, 20000);
  check('Finder launch', 'saves the API key (system keychain encryption works from the .app)', seen.some((t) => /Saved/.test(t)) && fs.existsSync(path.join(dirs.app, 'anthropic-key.bin')), seen.join(' / '));

  for (const v of ['drafts', 'sources', 'topics', 'brandkit', 'schedule', 'settings', 'reads', 'playbook']) {
    await nav(page, v);
    await shot(page, `02-screen-${v}`, { full: true });
    check('Finder launch', `${v} opens`, (await text(page)).length > 50, '', `02-screen-${v}`);
  }

  await nav(page, 'brandkit');
  for (const [label, file, want] of [['PDF', fx.pdf, /Added 1 file/], ['DOCX', fx.docx, /Added 1 file/], ['PNG', fx.png, /Added 1 file/], ['JPEG', fx.jpg, /Added 1 file/],
    ['too-big PDF', fx.bigPdf, /Too big/], ['fake PDF', fx.fakePdf, /real PDF/], ['70 MB DOCX', fx.bombDocx, /unpacks/], ['GIF', fx.gif, /Only/]]) {
    await dropFiles(page, [file]);
    const s = await waitFlash(page, want, 20000);
    check('Finder launch', `Brand kit drop: ${label}`, s.some((t) => want.test(t)), s.join(' / '));
  }
  await shot(page, '03-brandkit', { full: true });
  const docx = await page.locator('.kit-file:has-text("tone-of-voice.docx")').innerText().catch(() => '');
  check('Finder launch', 'PDF and DOCX text is read in the packaged app (the extraction helper runs without node on PATH)', /characters read/.test(docx) && (await page.locator('.kit-file').count()) === 4, docx.replace(/\s+/g, ' ').slice(0, 160), '03-brandkit');

  await nav(page, 'sources');
  await page.click('.card:has-text("Draft from a link") button:has-text("Ask Claude now")');
  await page.fill('input[aria-label="Article address"]', 'https://example.com/');
  await page.click('.card:has-text("Draft from a link") button:has-text("Draft it")');
  const d = await waitFlash(page, /Wrote|drafts|fail|couldn/i, 90000);
  await nav(page, 'drafts');
  await shot(page, '04-drafts');
  check('Finder launch', 'draft from a link reaches the API (mock) and returns drafts', /Take 1|Draft \d/.test(await text(page)), d.join(' / '), '04-drafts');

  await page.click('.persona-btn');
  await settle(page, 300);
  await page.click('.menu button:has-text("Add persona")');
  await settle(page);
  await page.fill('input[aria-label="Brand name"]', 'Night Market Bakery');
  await page.click('main button:has-text("Next")');
  await settle(page, 1200);
  await shot(page, '05-second-persona');
  check('Finder launch', 'a second persona can be added', /Night Market Bakery/.test(await page.locator('.persona-btn').innerText()), '', '05-second-persona');
  await page.click('.persona-btn');
  await settle(page, 300);
  await page.locator('.menu .item').first().click();
  await settle(page, 800);
} catch (e) {
  check('Run', 'finder walk finished without a script error', false, e.stack);
  await shot(page, 'zz-script-error').catch(() => {});
}
await quitApp(browser);
check('Finder launch', 'quits cleanly', !running());

({ browser, page } = await openApp());
try {
  await shot(page, '06-relaunch');
  check('Finder relaunch', 'opens on Drafts with the key still saved', !/Paste an API key to start/.test(await text(page)), '', '06-relaunch');
  await nav(page, 'brandkit');
  check('Finder relaunch', 'brand kit is still there', (await page.locator('.kit-file').count()) === 4);
  await page.click('.persona-btn');
  await settle(page, 300);
  await shot(page, '06-relaunch-personas');
  check('Finder relaunch', 'both personas are listed', /Night Market Bakery/.test(await page.locator('.menu').innerText()), '', '06-relaunch-personas');
} catch (e) {
  check('Run', 'finder relaunch finished without a script error', false, e.stack);
}
await quitApp(browser);
mock.stop();
fs.writeFileSync(path.join(OUT, 'finder-results.json'), JSON.stringify({ mode: 'finder', at: new Date().toISOString(), results }, null, 2) + '\n');
console.log(`\n${results.filter((r) => r.ok).length} passed, ${results.filter((r) => !r.ok).length} failed. Data folder: ${dirs.base}`);
if (results.some((r) => !r.ok)) process.exitCode = 1;
