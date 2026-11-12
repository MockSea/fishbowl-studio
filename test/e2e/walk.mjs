// The full walk of the web studio in a headless Chrome, run once per way of starting it:
//   STUDIO_E2E=1 node walk.mjs source       (node bin/fishbowl-studio.js from this checkout)
//   STUDIO_E2E=1 node walk.mjs npx          (npx --yes github:..., with a throwaway npm cache)
//   STUDIO_E2E=1 node walk.mjs standalone   (dist/fishbowl-studio-<os>-<arch>, no node on PATH)
// Each step screenshots into docs/qa/web-0.1.0/shots/<mode>-*.png and records a check in
// <mode>-results.json. The data folder is a fresh temp folder. No real API key: a local mock
// answers, a refusing server plays a bad key, a closed port plays no network, and one call goes
// to the real API with a made-up key. On macOS the made-up key goes into the login Keychain
// under that studio folder's own entry and is removed at the end.
// QA_REAL_CLAUDE=0 skips the steps that draft through the installed Claude Code (`claude -p`).
// QA_REAL_API=0 skips the one call to the real API.
if (process.env.STUDIO_E2E !== '1') process.exit(0);

const fs = await import('node:fs');
const path = await import('node:path');
const { spawnSync } = await import('node:child_process');
const { createHash } = await import('node:crypto');
const L = await import('./lib.mjs');
const { startMock, startRefusing, DEAD_URL } = await import('./api.mjs');
const { makeFixtures } = await import('./fixtures.mjs');
const { settle, shooter, nav, flashes, waitFlash, dropFiles, chooseFiles, OUT } = L;

const mode = process.argv[2] || 'source';
const { shot } = shooter(mode);
const dirs = L.tempDirs(mode);
const npmCache = path.join(dirs.base, 'npm-cache');
const fx = makeFixtures(path.join(dirs.base, 'fixtures'));
const results = [];
const FAKE_KEY = 'sk-ant-qa-not-a-real-key-0000000000000000';
const LINK = 'https://example.com/';
const FEED = process.env.QA_FEED || 'https://feeds.bbci.co.uk/news/technology/rss.xml';
const REAL_CLAUDE = process.env.QA_REAL_CLAUDE !== '0';
const outputs = [];

function check(area, name, ok, detail = '', shotName = null) {
  detail = L.scrub(detail);
  results.push({ area, name, ok: !!ok, detail: detail.slice(0, 600), shot: shotName ? `${mode}-${shotName}.png` : null });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${name}${detail ? ` :: ${detail.slice(0, 200)}` : ''}`);
}
const text = (page, sel = 'main') => page.evaluate((s) => (document.querySelector(s) || document.body).innerText, sel);
const has = async (page, s) => (await text(page)).includes(s);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
// A studio folder's own Keychain entry (macOS only). The account ends in a hash of the app
// folder's real path, as the studio names it (server/lib/keystore.js keyAccount).
const keyAccount = (appDir) => {
  let real;
  try { real = fs.realpathSync(appDir); } catch { real = path.resolve(appDir); }
  return `anthropic-api-key-${createHash('sha256').update(real).digest('hex').slice(0, 16)}`;
};
const keychainHas = (appDir) => process.platform !== 'darwin' ? null
  : spawnSync('/usr/bin/security', ['find-generic-password', '-s', 'Fishbowl Studio', '-a', keyAccount(appDir)], { stdio: 'ignore' }).status === 0;
const keychainRead = (appDir) => process.platform !== 'darwin' ? ''
  : spawnSync('/usr/bin/security', ['find-generic-password', '-s', 'Fishbowl Studio', '-a', keyAccount(appDir), '-w']).stdout?.toString().trim() || '';
const keychainDelete = (appDir) => { if (process.platform === 'darwin') spawnSync('/usr/bin/security', ['delete-generic-password', '-s', 'Fishbowl Studio', '-a', keyAccount(appDir)], { stdio: 'ignore' }); };
// Studio messages that read as the model's or the board's wording instead of the person's (WS-107 W4, W5).
const sloppy = (t) => /\.\.(?!\.)|do my studio|rewrites|\brewrite queue\b/i.test(t);

async function start(opts = {}) {
  const s = await L.startStudio({ mode, dirs, npmCache, ...opts });
  outputs.push(`--- start (${opts.claude || 'none'}) ---\n${s.text()}`);
  return s;
}
async function stop(s) {
  const code = await s.stop();
  outputs.push(`--- stop: ${code} ---\n${s.text().split('Press Ctrl+C to stop.').pop()}`);
  return code;
}

async function draftLinkNow(page, url = LINK) {
  await nav(page, 'sources');
  await page.click('.card:has-text("Draft from a link") button:has-text("Ask Claude now")');
  await page.fill('input[aria-label="Article address"]', url);
  await page.click('.card:has-text("Draft from a link") button:has-text("Draft it")');
}
async function goKeyPage(page) {
  await nav(page, 'settings');
  await page.click('button:has-text("Engine and API key")');
  await settle(page);
}
async function saveKey(page, key) {
  await page.fill('input[aria-label="Anthropic API key"]', key);
  await page.click('button:has-text("Save key"), button:has-text("Replace key")');
  return waitFlash(page, /./, 8000);
}
async function setEngine(page, label) {
  await goKeyPage(page);
  await page.locator('[aria-label="Which engine drafts"] button', { hasText: new RegExp(`^${label}$`) }).click();
  await waitFlash(page, /Saved/, 5000);
  await settle(page, 600);
}
// The studio's answer to a same-origin API call, from inside the page (with its cookie).
const apiFromPage = (page, name, body = {}) => page.evaluate(async ([n, b]) => {
  const r = await fetch(`/api/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.text() };
}, [name, body]);

keychainDelete(dirs.app); // nothing of ours left from an earlier, interrupted run
let mock = await startMock(18797, { MOCK_FEED: FEED });
process.on('exit', () => mock.stop()); // a crash must not leave the mock holding its port
const mockEnv = { STUDIO_ANTHROPIC_BASE_URL: mock.url };

// ---------- 1. First run, nothing to draft with ----------
let s = await start({ claude: 'none', env: mockEnv });
check('Start', 'prints the folder, the engine and a one-time link', /Studio folder: .*\n.*Not connected to Claude yet[\s\S]*Open it here \(the link works once\): http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]{64}/.test(s.text()), s.text().split('\n').slice(0, 4).join(' | '));
let { context, page, logs } = await L.openStudio(s.url);
try {
  check('Start', 'the link opens the studio and drops the token from the address bar', !/[?&]t=/.test(page.url()), page.url().replace(/\d{4,5}/, 'PORT'));
  await shot(page, '01-first-run');
  const first = await text(page);
  check('First run', 'opens on the Claude page when nothing can draft yet', first.includes('Anthropic API key') && first.includes('Save key') && /Not connected yet/.test(first), '', '01-first-run');
  const active = await page.evaluate(() => Array.from(document.querySelectorAll('.navbtn.active')).map((b) => b.dataset.view));
  check('First run', 'the sidebar shows which page is open (WS-102 B7)', active.length === 1 && active[0] !== 'drafts', `highlighted nav: ${JSON.stringify(active)}`, '01-first-run');
  check('First run', 'a default brand exists', await page.evaluate(() => document.querySelector('.persona-btn')?.innerText.includes('My brand')));
  check('First run', 'the Claude page says Claude Code is not installed when it is not on PATH', /Claude Code isn.t installed/.test(first), '', '01-first-run');

  for (const v of ['drafts', 'sources', 'topics', 'brandkit', 'schedule', 'settings', 'reads', 'coach', 'playbook']) {
    await nav(page, v);
    await shot(page, `02-screen-${v}`, { full: true });
    const t = await text(page);
    check('Screens', `${v} opens without an error`, t.length > 50 && !/Couldn.t load/.test(t), '', `02-screen-${v}`);
  }
  check('Screens', 'the Coach page is in the studio', !!(await page.$('.navbtn[data-view="coach"]')));
  check('Screens', 'no script errors in the page so far', !logs.some((l) => /pageerror|\[error\]/.test(l)), logs.filter((l) => /error/i.test(l)).join(' / '));
  await nav(page, 'drafts');
  const dt = await text(page);
  check('Copy', 'Drafts "how this works" does not mention a scheduled task (WS-102 B5)', !/scheduled task/.test(dt), (dt.match(/[^\n]*scheduled task[^\n]*/) || [''])[0], '02-screen-drafts');
  check('Copy', 'Drafts setup step counts the steps the wizard shows (WS-102 B5)', !/Four short steps/.test(dt), (dt.match(/[^\n]*Four short steps[^\n]*/) || [''])[0], '02-screen-drafts');
  await nav(page, 'topics');
  const tt = await text(page);
  const coachLink = await page.$('main a[data-view="coach"], main button:has-text("Coach")');
  check('Copy', 'Topics page points to the Coach page only while there is one (WS-102 B6)', !tt.includes('Coach page') || !!(await page.$('.navbtn[data-view="coach"]')), `${(tt.match(/[^\n]*Coach page[^\n]*/) || [''])[0]}${coachLink ? ' (links to it)' : ''}`, '02-screen-topics');

  await draftLinkNow(page);
  let seen = await waitFlash(page, /API key|Claude Code/i, 15000);
  await shot(page, '03-nothing-draft-link');
  check('Nothing connected', 'Draft from a link, Ask Claude now, says to add a key or install Claude Code', seen.some((t) => /API key/i.test(t)), seen.join(' / '), '03-nothing-draft-link');
  check('Nothing connected', 'the link is still queued for later', (await has(page, 'Queued')) || (await has(page, 'example.com')), '', '03-nothing-draft-link');
  await nav(page, 'schedule');
  await page.click('button:has-text("Run it now")');
  seen = await waitFlash(page, /API key/i, 10000);
  await shot(page, '03-nothing-run-now');
  check('Nothing connected', 'Schedule, Run it now, says to add a key', seen.some((t) => /API key/i.test(t)), seen.join(' / '), '03-nothing-run-now');

  // ---------- 2. API key ----------
  await goKeyPage(page);
  for (const [label, val, want] of [['empty', '', /Paste your/], ['too short', 'hello', /does not look like/], ['with a space', 'sk-ant-abc def-0000000000000000', /does not look like/], ['bad characters', 'sk-ant-<script>0000000000000000', /does not look like/]]) {
    seen = await saveKey(page, val);
    if (label === 'empty') await shot(page, '04-key-empty');
    check('API key', `refuses a key that is ${label}`, seen.some((t) => want.test(t)), seen.join(' / ') || '(no message)', label === 'empty' ? '04-key-empty' : null);
  }
  seen = await saveKey(page, FAKE_KEY);
  await settle(page, 1000);
  await shot(page, '04-key-saved');
  check('API key', 'saves a well-formed key, says so and moves on to Drafts', seen.some((t) => /Saved/.test(t)) && (await page.evaluate(() => document.querySelector('.navbtn.active')?.dataset.view)) === 'drafts', seen.join(' / '), '04-key-saved');
  const mark = readJson(path.join(dirs.app, 'key.json'));
  const wantStore = process.platform === 'darwin' ? 'keychain' : 'file';
  check('API key', `records the key as kept in the ${wantStore}, with only a hint`, mark && mark.store === wantStore && mark.hint === `…${FAKE_KEY.slice(-4)}`, JSON.stringify(mark));
  if (process.platform === 'darwin') check('API key', 'the Keychain has the studio\'s entry', keychainHas(dirs.app) === true);
  const leaks = fs.readdirSync(dirs.home, { recursive: true }).map((f) => path.join(dirs.home, String(f)))
    .filter((f) => fs.statSync(f).isFile() && fs.readFileSync(f).includes(Buffer.from(FAKE_KEY)));
  check('API key', 'the plain key is in no file in the studio folder', !leaks.length, leaks.map((f) => path.relative(dirs.home, f)).join(', '));
  check('API key', 'the key is not in the command\'s output', !s.text().includes(FAKE_KEY));
  await goKeyPage(page);
  await shot(page, '04-key-page-with-key');
  const kt = await text(page);
  check('API key', 'shows only a masked hint of the saved key', /A key ending \S+ is saved/.test(kt) && !kt.includes(FAKE_KEY) && (await page.inputValue('input[aria-label="Anthropic API key"]')) === '', (kt.match(/A key ending[^\n]*/) || [''])[0], '04-key-page-with-key');
  check('API key', 'says where the key is kept', process.platform !== 'darwin' || /Kept in the macOS Keychain/.test(kt), (kt.match(/Kept in[^\n]*/) || [''])[0], '04-key-page-with-key');
  const st = await apiFromPage(page, 'key/status');
  check('API key', 'the page never receives the key itself', st.status === 200 && !st.body.includes(FAKE_KEY), st.body.slice(0, 200));
  await page.click('button:has-text("Remove key")');
  seen = await waitFlash(page, /Removed/, 5000);
  await settle(page, 600);
  await shot(page, '04-key-removed');
  check('API key', 'Remove key deletes the stored key', !fs.existsSync(path.join(dirs.app, 'key.json')) && seen.some((t) => /Removed/.test(t)) && keychainHas(dirs.app) !== true, `${seen.join(' / ')}; keychain entry: ${keychainHas(dirs.app)}`, '04-key-removed');
  seen = await saveKey(page, FAKE_KEY);
  check('API key', 'a key can be saved again after removing', fs.existsSync(path.join(dirs.app, 'key.json')), seen.join(' / '));
  await setEngine(page, 'API key');
  await shot(page, '04-engine-api');
  check('Engine', 'choosing API key saves the preference and says it drafts with the key', readJson(path.join(dirs.app, 'prefs.json'))?.engine === 'api' && /Drafting with your Anthropic API key/.test(await text(page)), JSON.stringify(readJson(path.join(dirs.app, 'prefs.json'))), '04-engine-api');

  // ---------- 3. Setup wizard (mock API) ----------
  await nav(page, 'drafts');
  await page.click('button:has-text("Start setup")');
  await settle(page);
  await page.fill('input[aria-label="Brand name"]', 'Spoke and Chain');
  await shot(page, '05-setup-brand');
  await page.click('main button:has-text("Next")');
  await settle(page, 1000);
  const answers = ['People who ride to work in the city.', 'Warm, practical, a little dry.', 'Bike repair, commuting, winter riding.', 'Politics.', 'Short posts.', 'Fix it yourself tips.'];
  const tas = page.locator('main textarea');
  for (let k = 0; k < await tas.count(); k++) await tas.nth(k).fill(answers[k % answers.length]);
  await shot(page, '05-setup-questions');
  await page.click('main button:has-text("Draft it for me")');
  seen = await waitFlash(page, /Saved|suggestion|failed|refused|error/i, 60000);
  await settle(page, 1500);
  await shot(page, '05-setup-drafts', { full: true });
  check('Setup', 'Draft it for me returns setup drafts (API key engine, mock API)', await has(page, 'first draft'), seen.join(' / '), '05-setup-drafts');
  check('Copy', 'setup drafts message is written for the person (WS-102 B3)', !seen.some((t) => /suggestion\(s\)|for them to/.test(t)), seen.join(' / '), '05-setup-drafts');
  check('Setup', 'the brand name from step 1 is used', await has(page, 'Spoke and Chain'), '', '05-setup-drafts');
  await page.click('button:has-text("Keep everything")');
  await settle(page, 1500);
  await page.click('main button:has-text("Next")');
  await settle(page, 1000);
  await shot(page, '05-setup-finish');
  check('Setup', 'the last step offers Run on its own, not posting', /Run on its own/.test(await text(page)) && !/Post for me/.test(await text(page)), '', '05-setup-finish');
  await page.click('main button:has-text("Finish setup")');
  await settle(page, 1500);
  await shot(page, '05-setup-done');
  check('Setup', 'Finish setup leaves the wizard', !(await has(page, 'Finish setup')), '', '05-setup-done');
  const pbtn = await page.locator('.persona-btn').innerText();
  check('Personas', 'renaming the first brand in setup renames its handle too (WS-102 B10)', !/my-brand/.test(pbtn), pbtn.replace(/\s+/g, ' '), '05-setup-done');

  // ---------- 4. Draft from a link, Run it now (mock API) ----------
  await draftLinkNow(page);
  seen = await waitFlash(page, /Wrote|Done|fail|error|couldn/i, 90000);
  await settle(page, 1500);
  await shot(page, '06-link-sources');
  check('Draft from a link', 'the link is fetched and drafted', seen.some((t) => /Wrote [1-9]/.test(t)), seen.join(' / '), '06-link-sources');
  await nav(page, 'drafts');
  await settle(page, 1000);
  await shot(page, '06-link-drafts', { full: true });
  check('Draft from a link', 'drafts show on the Drafts page', /Draft \d/.test(await text(page)), '', '06-link-drafts');
  const pick = page.locator('main button:has-text("Use this one")').first();
  let pickSeen = [];
  if (await pick.count()) {
    await pick.click();
    pickSeen = await waitFlash(page, /./, 5000);
    await settle(page, 1200);
    await shot(page, '06-take-picked');
    const after = await text(page);
    check('Drafts', '"Use this one" keeps that take and sets the others aside', /Skipped\s*[1-9]/.test(after), after.match(/To review\s*\d+\s*Approved\s*\d+\s*Skipped\s*\d+/)?.[0] || '', '06-take-picked');
  } else check('Drafts', 'a link draft offers takes to pick from', false, 'no "Use this one" button');
  const approveBtn = page.locator('main').getByRole('button', { name: 'Approve', exact: true }).first();
  if (await approveBtn.count()) {
    await approveBtn.click();
    seen = await waitFlash(page, /./, 6000);
    await settle(page, 1000);
    await shot(page, '06-draft-approved');
    check('Drafts', 'Approve moves a draft to Approved', /Approved\s*[1-9]/.test(await text(page)), (await text(page)).match(/To review\s*\d+\s*Approved\s*\d+/)?.[0] || '', '06-draft-approved');
    const said = [...pickSeen, ...seen];
    check('Copy', 'pick and approve messages use the studio\'s own words (WS-102 B4)', !said.some((t) => /Passed tab|pass, edit or kill/.test(t)), said.join(' / '), '06-draft-approved');
  } else check('Drafts', 'Approve button present on a draft', false, 'no draft to approve');
  await shot(page, '06-short-page');
  const sp = await page.evaluate(() => ({ window: window.innerHeight, page: Math.round(document.body.getBoundingClientRect().height), bg: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor }));
  check('Layout', 'the background fills the window when a page is short (WS-102 B8)', sp.page >= sp.window - 1 || sp.bg === sp.body, `window ${sp.window}px, body ${sp.page}px, html bg ${sp.bg}, body bg ${sp.body}`, '06-short-page');
  await nav(page, 'schedule');
  await page.click('button:has-text("Run it now")');
  seen = await waitFlash(page, /Read |Nothing new|fail|error|couldn|Triaged/i, 120000);
  await settle(page, 1000);
  await shot(page, '06-run-now');
  check('Daily run', 'Run it now reads the brand\'s feed and reports what it did (mock API)', seen.some((t) => /Triaged \d+, wrote/.test(t)), seen.join(' / '), '06-run-now');
  check('Copy', 'the Run it now message has no doubled full stop (WS-107 W4)', !seen.some((t) => /\.\.(?!\.)/.test(t)), seen.join(' / '), '06-run-now');
  check('Draft from a link', 'the mock received setup, triage and drafting calls', mock.lines.some((l) => /voice/.test(l)) && mock.lines.some((l) => /takes/.test(l)), mock.lines.slice(1, 6).join(' / '));

  // ---------- 5. Brand kit ----------
  await nav(page, 'brandkit');
  await shot(page, '07-kit-empty');
  const kitCases = [
    ['PDF', [fx.pdf], /Added 1 file/, true],
    ['DOCX', [fx.docx], /Added 1 file/, true],
    ['Markdown', [fx.md], /Added 1 file/, true],
    ['PNG image', [fx.png], /Added 1 file/, true],
    ['JPEG image', [fx.jpg], /Added 1 file/, true],
    ['too-big PDF (11 MB)', [fx.bigPdf], /Too big/, false],
    ['too-big image (6 MB PNG)', [fx.bigPng], /Too big/, false],
    ['text file named .pdf', [fx.fakePdf], /doesn.t look like a real PDF/, false],
    ['text file named .png', [fx.fakePng], /doesn.t look like a real Image/, false],
    ['corrupt DOCX', [fx.corruptDocx], /Word file|No text/, false],
    ['DOCX that unpacks to 70 MB', [fx.bombDocx], /unpacks to more than/, false],
    ['scanned PDF with no text', [fx.scanPdf], /no text|No text/, false],
    ['empty file', [fx.empty], /empty/, false],
    ['GIF (unsupported type)', [fx.gif], /Only/, false],
    ['.exe (unsupported type)', [fx.exe], /Only/, false],
  ];
  let i = 0;
  for (const [label, files, want, added] of kitCases) {
    i++;
    const before = await page.locator('.kit-file').count();
    await dropFiles(page, files);
    seen = await waitFlash(page, want, 20000);
    await settle(page, 600);
    const name = `07-kit-${String(i).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/-+$/, '')}`;
    await shot(page, name);
    const after = await page.locator('.kit-file').count();
    check('Brand kit', `drop ${label}: ${added ? 'added' : 'refused with a reason'}`, seen.some((t) => want.test(t)) && (added ? after === before + 1 : after === before), `${seen.join(' / ') || '(no message)'}; files ${before} -> ${after}`, name);
  }
  await shot(page, '07-kit-full-list', { full: true });
  const pdfRow = await page.locator('.kit-file:has-text("brand-guidelines.pdf")').innerText().catch(() => '');
  check('Brand kit', 'the PDF row shows the text it read', /Spoke and Chain/.test(pdfRow), pdfRow.replace(/\s+/g, ' ').slice(0, 200), '07-kit-full-list');
  const docxRow = await page.locator('.kit-file:has-text("tone-of-voice.docx")').innerText().catch(() => '');
  check('Brand kit', 'the DOCX row shows the text it read', /Spoke and Chain/.test(docxRow), docxRow.replace(/\s+/g, ' ').slice(0, 200), '07-kit-full-list');
  await dropFiles(page, [fx.pdf, fx.gif]);
  seen = await waitFlash(page, /animation\.gif|Added/, 15000);
  seen.push(...await flashes(page, { wait: 1500 }));
  await settle(page, 600);
  await shot(page, '07-kit-mixed-drop', { full: true });
  const names = await page.locator('.kit-file .nm').allInnerTexts();
  check('Brand kit', 'a mixed drop (one good, one bad) reports both (WS-102 B2)', seen.some((t) => /animation\.gif/.test(t)) && seen.some((t) => /Added|brand-guidelines/.test(t)), `${seen.join(' / ')}; files now: ${names.join(', ')}`, '07-kit-mixed-drop');
  const dupes = names.filter((n) => n === 'brand-guidelines.pdf').length;
  check('Brand kit', 'adding a file already in the kit does not add a second copy (WS-102 B1)', dupes === 1, `brand-guidelines.pdf appears ${dupes} times`, '07-kit-mixed-drop');
  const n0 = await page.locator('.kit-file').count();
  await chooseFiles(page, [fx.md2, fx.txt]);
  seen = await waitFlash(page, /Added|Only|Too/, 15000);
  await settle(page, 800);
  await shot(page, '07-kit-choose-files');
  check('Brand kit', 'Choose files opens the browser\'s file picker and adds the picked files', (await page.locator('.kit-file').count()) === n0 + 2, `${seen.join(' / ')}; files ${n0} -> ${await page.locator('.kit-file').count()}`, '07-kit-choose-files');
  const n1 = await page.locator('.kit-file').count();
  const row = page.locator('.kit-file').last();
  await row.locator('button').first().click();
  await settle(page, 300);
  await shot(page, '07-kit-remove-confirm');
  await row.locator('button').first().click().catch(() => {});
  seen = await waitFlash(page, /Removed/, 5000);
  await settle(page, 800);
  await shot(page, '07-kit-removed');
  check('Brand kit', 'Remove asks once more, then removes the file', (await page.locator('.kit-file').count()) === n1 - 1, seen.join(' / '), '07-kit-remove-confirm');
  const kitFiles = await page.locator('.kit-file').count();
  const before = mock.lines.length;
  await draftLinkNow(page, 'https://example.org/');
  seen = await waitFlash(page, /Wrote|fail|error/i, 90000);
  const kitLine = mock.lines.slice(before).find((l) => /takes/.test(l)) || '';
  check('Brand kit', 'the next drafting call carries the kit (docs and images)', /kit: [1-9]\d* docs, [1-9]\d* images/.test(kitLine), kitLine.replace(/^\S+ /, '') || mock.lines.slice(before).join(' / '));
  await nav(page, 'drafts');
  await settle(page, 800);
  const noneOf = page.locator('main button:has-text("None of these…")').first();
  if (await noneOf.count()) { await noneOf.click(); await settle(page, 300); }
  const tryAgain = page.locator('main button:has-text("None, try again")').first();
  if (await tryAgain.count()) {
    await tryAgain.click();
    const redoSaid = await waitFlash(page, /./, 6000);
    await settle(page, 800);
    await shot(page, '06-redo-queued');
    check('Copy', 'the redo message says when the new takes come, in the studio\'s words (WS-107 W5)', redoSaid.some((t) => /next run|Run it now/.test(t)) && !redoSaid.some(sloppy), redoSaid.join(' / '), '06-redo-queued');
  } else check('Copy', 'a drafted set offers "None, try again" (WS-107 W5)', false, 'no "None of these…" set with "None, try again" after a link draft');

  // ---------- 6. Caps ----------
  const usageFile = path.join(dirs.app, 'usage.json');
  const usage = readJson(usageFile);
  check('Caps', 'model calls are counted for today in the app folder', usage && usage.day === L.localDay() && usage.calls > 0, JSON.stringify(usage));
  await goKeyPage(page);
  check('Caps', 'the Claude page shows today\'s count against 150', new RegExp(`Today: ${usage?.calls} of 150 model calls`).test(await text(page)), (await text(page)).match(/Today:[^\n]*/)?.[0] || '');
  fs.writeFileSync(usageFile, JSON.stringify({ day: L.localDay(), calls: 150 }) + '\n');
  await goKeyPage(page);
  await shot(page, '08-cap-used-up');
  check('Caps', 'with 150 calls used the Claude page says so', /Today: 150 of 150 model calls/.test(await text(page)), '', '08-cap-used-up');
  const capBefore = mock.lines.length;
  await draftLinkNow(page, 'https://example.net/');
  seen = await waitFlash(page, /used up|limit|Wrote|Nothing/i, 30000);
  await shot(page, '08-cap-link');
  check('Caps', 'at the daily cap a link draft makes no model call and says why', mock.lines.length === capBefore && seen.some((t) => /used up|limit/i.test(t)), `${seen.join(' / ')}; mock calls during: ${mock.lines.length - capBefore}`, '08-cap-link');
  check('Copy', 'the link draft messages use the studio\'s own words (WS-107 W3, W5)', !seen.some(sloppy) && !seen.some((t) => /no model calls left/i.test(t) && /Today/.test(t)), seen.join(' / '), '08-cap-link');
  await nav(page, 'schedule');
  await page.click('button:has-text("Run it now")');
  seen = await waitFlash(page, /used up|limit|Triaged|fail/i, 60000);
  await shot(page, '08-cap-run-now');
  check('Caps', 'at the daily cap Run it now makes no model call and says why', mock.lines.length === capBefore && seen.some((t) => /used up|limit/i.test(t)), `${seen.join(' / ')}; mock calls during: ${mock.lines.length - capBefore}`, '08-cap-run-now');
  fs.writeFileSync(usageFile, JSON.stringify({ day: '2000-01-01', calls: 150 }) + '\n');
  await goKeyPage(page);
  check('Caps', 'a count from an earlier day does not carry over', /Today: 0 of 150/.test(await text(page)), (await text(page)).match(/Today:[^\n]*/)?.[0] || '');

  // ---------- 7. Second brand ----------
  await page.click('.persona-btn');
  await settle(page, 300);
  await shot(page, '09-persona-menu');
  await page.click('.menu button:has-text("Add persona")');
  await settle(page);
  await page.fill('input[aria-label="Brand name"]', 'Night Market Bakery');
  await page.click('main button:has-text("Next")');
  await settle(page, 1200);
  await shot(page, '09-persona-second-setup');
  const btn = await page.locator('.persona-btn').innerText();
  check('Personas', 'Add persona creates and switches to the new brand', /Night Market Bakery/.test(btn), btn.replace(/\s+/g, ' '), '09-persona-second-setup');
  await nav(page, 'brandkit');
  check('Personas', 'the second brand has its own, empty brand kit', (await page.locator('.kit-file').count()) === 0);
  await dropFiles(page, [fx.png]);
  await waitFlash(page, /Added/, 10000);
  await nav(page, 'settings');
  await shot(page, '09-settings', { full: true });
  check('Personas', 'the engine and key are shared across brands', /Drafting with your Anthropic API key/.test(await text(page)), '', '09-settings');
  await page.click('.persona-btn');
  await settle(page, 300);
  await shot(page, '09-persona-menu-two');
  const menuNames = await page.evaluate(() => Array.from(document.querySelectorAll('.menu button, .menu .item')).map((b) => ({ t: b.innerText.replace(/\s+/g, ' ').trim(), clipped: Array.from(b.querySelectorAll('*')).some((e) => e.scrollWidth > e.clientWidth + 1) })));
  check('Personas', 'brand names are not cut off in the brand menu (WS-102 B9)', !menuNames.some((m) => /Spoke and Chain|Night Market/.test(m.t) && m.clipped), JSON.stringify(menuNames), '09-persona-menu-two');
  await page.click('.menu button:has-text("Spoke and Chain")');
  await settle(page, 1000);
  await nav(page, 'brandkit');
  await shot(page, '09-persona-switched-back');
  check('Personas', 'switching back shows the first brand\'s kit', (await page.locator('.kit-file').count()) === kitFiles, `${await page.locator('.kit-file').count()} files, expected ${kitFiles}`, '09-persona-switched-back');
  await nav(page, 'settings');
  const yb = await page.evaluate(() => Array.from(document.querySelectorAll('main *')).filter((e) => e.children.length === 0 && /Spok|Night Ma/.test(e.textContent) && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()));
  await shot(page, '09-your-brands');
  check('Personas', 'brand names are not cut off in Your brands (WS-102 B9)', !yb.length, yb.length ? `clipped: ${yb.join(', ')}` : '', '09-your-brands');

  // ---------- 8. Schedule, topics, window sizes ----------
  await nav(page, 'schedule');
  await page.click('button[aria-label="Run while the studio is open"]');
  seen = await waitFlash(page, /run on its own|off/i, 5000);
  await shot(page, '10-schedule-autorun-on');
  const prefs = readJson(path.join(dirs.app, 'prefs.json'));
  check('Schedule', 'Run on its own saves to the app preferences', prefs?.autorun === true && prefs?.engine === 'api', `${JSON.stringify(prefs)}; ${seen.join(' / ')}`, '10-schedule-autorun-on');
  await nav(page, 'topics');
  await page.fill('main input[type=text]', 'tune-ups').catch(() => {});
  await page.click('main button:has-text("Add")').catch(() => {});
  await settle(page, 800);
  await shot(page, '10-topics-added');
  check('Topics', 'a topic can be added', await has(page, 'tune'), '', '10-topics-added');
  for (const [w, h, label] of [[900, 600, 'narrow'], [390, 844, 'phone']]) {
    await page.setViewportSize({ width: w, height: h });
    for (const v of ['drafts', 'brandkit']) {
      if (label === 'phone') { const menu = page.locator('button[aria-label*="menu" i], .menu-btn, .hamburger').first(); if (await menu.count() && await menu.isVisible()) { await menu.click(); await settle(page, 300); } }
      await page.locator(`.navbtn[data-view="${v}"]`).click({ timeout: 3000 }).catch(async () => { await page.evaluate((x) => document.querySelector(`.navbtn[data-view="${x}"]`).click(), v); });
      await settle(page, 600);
      await shot(page, `10-${label}-${v}`);
    }
    await page.goto(page.url()).catch(() => {});
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check('Layout', `no sideways scroll at ${w}x${h}`, !overflow, '', `10-${label}-brandkit`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  check('Screens', 'reloading the page keeps the session (cookie)', await page.locator('.navbtn').count() > 0);

  // ---------- 9. Closing the tab, a second launch ----------
  await context.close();
  const again = await start({ claude: 'none', env: mockEnv });
  const reused = again.text();
  const againCode = await new Promise((r) => { if (again.proc.exitCode !== null) r(again.proc.exitCode); else again.proc.once('exit', r); });
  check('Second launch', 'a second start while it runs hands out a new link to the running studio and exits', /already running\. Opening it: http:\/\/127\.0\.0\.1:\d+\/\?t=/.test(reused) && againCode === 0, reused.trim().replace(/t=\w+/, 't=…'));
  ({ context, page, logs } = await L.openStudio(again.url));
  await shot(page, '11-second-launch');
  check('Second launch', 'that link opens the same studio, still on the saved brand', /Spoke and Chain/.test(await page.locator('.persona-btn').innerText()), '', '11-second-launch');
  const reuse = await (await fetch(again.url)).status;
  check('Second launch', 'the new link works only once', reuse === 403, `second use: ${reuse}`);
} catch (e) {
  check('Run', 'walk finished without a script error', false, e.stack);
  await shot(page, 'zz-script-error').catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, `${mode}-console-1.log`), logs.join('\n') + '\n');
  await context.close().catch(() => {});
}
const lockFile = path.join(dirs.app, 'server.json');
const lockMode = fs.existsSync(lockFile) ? (fs.statSync(lockFile).mode & 0o777).toString(8) : null;
check('Stop', 'the lock file is private (600) while it runs', lockMode === '600', `mode ${lockMode}`);
const code = await stop(s);
check('Stop', 'Ctrl+C stops it, says so and removes the lock file', (code === 0 || (mode === 'npx' && code === 'SIGINT')) && /Stopped\./.test(s.text()) && !fs.existsSync(lockFile), `exit ${code}${mode === 'npx' ? ' (npm re-raises the SIGINT it was sent; the studio under it exits 0)' : ''}`);

// ---------- 10. Restart ----------
s = await start({ claude: 'none', env: mockEnv });
({ context, page, logs } = await L.openStudio(s.url));
try {
  check('Restart', 'the start message names where the key is kept', /Your API key is kept in: the macOS Keychain|Your API key is kept in/.test(s.text()) && /Drafting with your Anthropic API key/.test(s.text()), s.text().split('\n').slice(0, 4).join(' | '));
  await shot(page, '12-restart');
  check('Restart', 'opens on Drafts, not the Claude page, once a key is saved', (await page.evaluate(() => document.querySelector('.navbtn.active')?.dataset.view)) === 'drafts', '', '12-restart');
  check('Restart', 'remembers the active brand', /Spoke and Chain/.test(await page.locator('.persona-btn').innerText()), await page.locator('.persona-btn').innerText());
  await nav(page, 'brandkit');
  check('Restart', 'the brand kit is still there', (await page.locator('.kit-file').count()) > 0);
  await nav(page, 'schedule');
  check('Restart', 'Run on its own is still on', (await page.locator('button[aria-label="Run while the studio is open"]').getAttribute('aria-checked')) === 'true');
  await page.click('button[aria-label="Run while the studio is open"]');
  await settle(page, 500);
  await goKeyPage(page);
  await shot(page, '12-restart-claude');
  const kt = await text(page);
  check('Restart', 'the key and the engine choice are still saved', /A key ending/.test(kt) && /Drafting with your Anthropic API key/.test(kt), '', '12-restart-claude');
  await nav(page, 'drafts');
  await shot(page, '12-restart-drafts', { full: true });
  check('Restart', 'drafts from before are still there', /Approved\s*[1-9]|Draft \d/.test(await text(page)), '', '12-restart-drafts');
} catch (e) {
  check('Run', 'restart finished without a script error', false, e.stack);
} finally {
  fs.writeFileSync(path.join(OUT, `${mode}-console-2.log`), logs.join('\n') + '\n');
  await context.close().catch(() => {});
  await stop(s);
}

// ---------- 11. Claude Code ----------
// a. A claude that fails (signed out), engine Automatic, key saved: one call falls back to the key.
fs.writeFileSync(path.join(dirs.app, 'prefs.json'), JSON.stringify({ autorun: false, engine: 'auto' }) + '\n');
s = await start({ claude: 'broken', env: mockEnv });
({ context, page, logs } = await L.openStudio(s.url));
try {
  check('Claude Code', 'with claude on PATH and Automatic, the start message says Claude Code drafts', /Drafting with Claude Code/.test(s.text()), s.text().split('\n')[2]);
  const before = mock.lines.length;
  await draftLinkNow(page, 'https://example.com/?fallback');
  const seen = await waitFlash(page, /Wrote|fail|error|couldn/i, 90000);
  await shot(page, '13-fallback');
  check('Claude Code', 'when Claude Code fails, Automatic switches to the key and says so', seen.some((t) => /Using your Anthropic API key instead/.test(t)) && mock.lines.length > before, seen.join(' / '), '13-fallback');
  await goKeyPage(page);
  await shot(page, '13-fallback-claude-page');
  check('Claude Code', 'the Claude page says Claude Code failed earlier', /Claude Code failed earlier/.test(await text(page)), (await text(page)).match(/Claude Code failed earlier[^\n]*/)?.[0] || '', '13-fallback-claude-page');
} catch (e) {
  check('Run', 'fallback step finished without a script error', false, e.stack);
} finally { await context.close().catch(() => {}); await stop(s); }

// b. The installed Claude Code, engine Claude Code: setup drafts for a new brand and a link.
if (REAL_CLAUDE) {
  s = await start({ claude: 'real' });
  ({ context, page, logs } = await L.openStudio(s.url));
  try {
    await setEngine(page, 'Claude Code');
    await shot(page, '14-engine-claude');
    check('Claude Code', 'choosing Claude Code says it drafts on the Claude plan', /Drafting with Claude Code, on your Claude plan/.test(await text(page)) && /Claude Code is installed/.test(await text(page)), '', '14-engine-claude');
    await page.click('.persona-btn');
    await page.click('.menu button:has-text("Night Market Bakery")');
    await settle(page, 1000);
    // This brand finished setup in step 7, so setup is opened again from Settings.
    await nav(page, 'settings');
    await page.click('button:has-text("Open setup")');
    await settle(page, 1000);
    if (await page.locator('input[aria-label="Brand name"]').count()) { await page.click('main button:has-text("Next")'); await settle(page, 800); }
    const tas = page.locator('main textarea');
    const ans = ['Neighbours who stop by the night market on Fridays.', 'Friendly and short.', 'Sourdough, seasonal bakes, market news.', 'Diet fads.', 'Short posts.', 'What came out of the oven.'];
    for (let k = 0; k < await tas.count(); k++) await tas.nth(k).fill(ans[k % ans.length]);
    await page.click('main button:has-text("Draft it for me")');
    let seen = await waitFlash(page, /Saved|fail|error|couldn|stopped/i, 300000);
    await settle(page, 1500);
    await shot(page, '14-claude-setup-drafts', { full: true });
    check('Claude Code', 'setup drafts come back through the installed Claude Code (claude -p)', await has(page, 'first draft'), seen.join(' / '), '14-claude-setup-drafts');
    await page.click('button:has-text("Keep everything")').catch(() => {});
    await settle(page, 1200);
    await page.click('main button:has-text("Next")').catch(() => {});
    await settle(page, 800);
    await page.click('main button:has-text("Finish setup")').catch(() => {});
    await settle(page, 1200);
    await draftLinkNow(page, 'https://example.com/');
    seen = await waitFlash(page, /Wrote|fail|error|couldn|stopped/i, 400000);
    await nav(page, 'drafts');
    await settle(page, 1000);
    await shot(page, '14-claude-link-drafts', { full: true });
    check('Claude Code', 'a link draft comes back through the installed Claude Code', seen.some((t) => /Wrote [1-9]/.test(t)), seen.join(' / '), '14-claude-link-drafts');
    const runs = path.join(dirs.app, 'claude-runs');
    const left = fs.existsSync(runs) ? fs.readdirSync(runs) : [];
    check('Claude Code', 'each claude -p run gets a work folder inside the app folder, cleared after', fs.existsSync(runs) && left.length === 0, `left behind: ${left.join(', ') || 'none'}`);
  } catch (e) {
    check('Run', 'Claude Code step finished without a script error', false, e.stack);
  } finally {
    // The API error steps below draft with the key.
    await setEngine(page, 'API key').catch((e) => check('Run', 'engine set back to API key', false, e.message));
    await context.close().catch(() => {}); await stop(s);
  }
}
mock.stop();

// ---------- 12. API errors ----------
async function errorRun(label, env, want, name) {
  const r = await start({ claude: 'none', env });
  const o = await L.openStudio(r.url);
  try {
    await draftLinkNow(o.page, `https://example.net/?${name}`);
    const seen = await waitFlash(o.page, want, 120000);
    await o.page.waitForTimeout(300);
    await shot(o.page, name);
    check('API errors', label, seen.some((t) => want.test(t)), seen.join(' / ') || '(no message)', name);
  } catch (e) { check('API errors', label, false, e.message); } finally { await o.context.close().catch(() => {}); await stop(r); }
}
const refusing = await startRefusing(401, 18798);
await errorRun('a refused (bad) key says so in plain words', { STUDIO_ANTHROPIC_BASE_URL: refusing.url }, /refused the API key/, '15-bad-key');
check('API errors', 'the bad-key server received the key (the SDK sends it as Authorization: Bearer)', refusing.seen.some((x) => x.key !== 'missing'), JSON.stringify(refusing.seen.slice(0, 1)));
refusing.stop();
const t0 = Date.now();
await errorRun('no network to the API says so', { STUDIO_ANTHROPIC_BASE_URL: DEAD_URL }, /reach Anthropic/, '15-no-network');
check('API errors', 'the no-network error arrives within 60 seconds', Date.now() - t0 < 60000, `${Math.round((Date.now() - t0) / 1000)} s`);
const rl = await startRefusing(429, 18799);
await errorRun('rate limiting says to try again', { STUDIO_ANTHROPIC_BASE_URL: rl.url }, /rate limit/i, '15-rate-limit');
rl.stop();
if (process.env.QA_REAL_API !== '0') await errorRun('the real Anthropic API refuses a made-up key with the bad-key message', {}, /refused the API key/, '15-real-api-fake-key');

// ---------- 13. Each studio folder keeps its own key ----------
// A second studio folder on the same computer (another --home) with its own key.
s = await start({ claude: 'none' });
({ context, page } = await L.openStudio(s.url));
const other = L.tempDirs(`${mode}-other`);
let s2 = null;
try {
  s2 = await L.startStudio({ mode, dirs: other, npmCache, claude: 'none' });
  const o = await L.openStudio(s2.url);
  await saveKey(o.page, 'sk-ant-qa-second-folder-key-1111111111111');
  await o.context.close();
  await goKeyPage(page);
  const shown = (await text(page)).match(/A key ending \S+/)?.[0] || '';
  const status = readJson(path.join(dirs.app, 'key.json'));
  const stored = keychainRead(dirs.app), storedOther = keychainRead(other.app);
  await shot(page, '16-shared-keychain');
  check('Key store', 'a key saved in a second studio folder leaves the first folder\'s key alone (WS-107 W2)', process.platform !== 'darwin' || (stored === FAKE_KEY && storedOther.endsWith('1111') && keyAccount(dirs.app) !== keyAccount(other.app)), `first folder shows "${shown}" (key.json hint ${status?.hint}); its Keychain entry ends ${stored.slice(-4)}, the second folder's ends ${storedOther.slice(-4)}`, '16-shared-keychain');
  await page.click('button:has-text("Remove key")');
  await waitFlash(page, /Removed/, 5000);
  // The second folder after the first folder's Remove: its own key is still there.
  await s2.stop();
  s2 = await L.startStudio({ mode, dirs: other, npmCache, claude: 'none' });
  const o2 = await L.openStudio(s2.url);
  await goKeyPage(o2.page);
  const shown2 = (await text(o2.page)).match(/A key ending \S+|No key|not set|Add your/i)?.[0] || '';
  await draftLinkNow(o2.page, 'https://example.net/?after-remove');
  const said2 = await waitFlash(o2.page, /./, 20000);
  await o2.page.waitForTimeout(500);
  await shot(o2.page, '16-other-folder-after-remove');
  check('Key store', 'after Remove in one folder, the other folder keeps its own key (WS-107 W2)', /A key ending \S*1111/.test(shown2) && (process.platform !== 'darwin' || keychainHas(other.app) === true) && !said2.some((t) => /null|undefined|reading/.test(t)), `key page shows "${shown2}"; link draft says: ${said2.join(' / ') || '(nothing)'}; other.key.json: ${JSON.stringify(readJson(path.join(other.app, 'key.json')))}`, '16-other-folder-after-remove');
  // A saved key deleted from the Keychain behind the studio's back: the page says so (WS-107 W2).
  if (process.platform === 'darwin') {
    keychainDelete(other.app);
    await goKeyPage(o2.page);
    const gone = await text(o2.page);
    await shot(o2.page, '16-key-deleted-outside');
    check('Key store', 'a key deleted from the Keychain outside the studio is reported, with what to do (WS-107 W2)', /isn.t in the macOS Keychain any more\. Add it again/.test(gone) && !/A key ending/.test(gone), (gone.match(/[^\n]*Keychain[^\n]*/) || [''])[0], '16-key-deleted-outside');
  }
  await o2.context.close();
} catch (e) {
  check('Run', 'key store step finished without a script error', false, e.stack);
} finally {
  await context.close().catch(() => {});
  await stop(s);
  if (s2) await s2.stop();
}
keychainDelete(dirs.app);
keychainDelete(other.app);
check('Cleanup', 'the studio\'s Keychain entries are gone after the walk', keychainHas(dirs.app) !== true && keychainHas(other.app) !== true);
await L.closeBrowser();
fs.writeFileSync(path.join(OUT, `${mode}-cli-output.log`), L.scrub(outputs.join('\n')) + '\n');
fs.writeFileSync(path.join(OUT, `${mode}-results.json`), JSON.stringify({ mode, at: new Date().toISOString(), results }, null, 2) + '\n');
console.log(`\n${results.filter((r) => r.ok).length} passed, ${results.filter((r) => !r.ok).length} failed. Data folder: ${dirs.base}`);
