// The full walk of the desktop app, run once per launch mode:
//   STUDIO_E2E=1 node walk.mjs source   (like `npm run desktop`)
//   STUDIO_E2E=1 node walk.mjs built    (the packaged .app binary, Finder-like PATH)
// Each step screenshots into docs/qa/electron-0.1.0/shots/<mode>-*.png and records a check in
// <mode>-results.json. No real API key: a local mock answers, a refusing server plays a bad key,
// a closed port plays no network, and one call goes to the real API with a made-up key.
if (process.env.STUDIO_E2E !== '1') process.exit(0);

const fs = await import('node:fs');
const path = await import('node:path');
const { launch, tempDirs, settle, close, shooter, nav, flashes, waitFlash, dropFiles, stubOpenDialog, OUT } = await import('./lib.mjs');
const { startMock, startRefusing, DEAD_URL } = await import('./api.mjs');
const { makeFixtures } = await import('./fixtures.mjs');

const mode = process.argv[2] || 'source';
const { shot } = shooter(mode);
const dirs = tempDirs(mode);
const fx = makeFixtures(path.join(dirs.base, 'fixtures'));
const results = [];
const FAKE_KEY = 'sk-ant-qa-not-a-real-key-0000000000000000';
const LINK = 'https://example.com/';

function check(area, name, ok, detail = '', shotName = null) {
  results.push({ area, name, ok: !!ok, detail: String(detail).slice(0, 600), shot: shotName ? `${mode}-${shotName}.png` : null });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${name}${detail ? ` :: ${String(detail).slice(0, 200)}` : ''}`);
}
const text = (page, sel = 'main') => page.evaluate((s) => (document.querySelector(s) || document.body).innerText, sel);
const has = async (page, s) => (await text(page)).includes(s);

async function draftLinkNow(page, url = LINK) {
  await nav(page, 'sources');
  await page.click('.card:has-text("Draft from a link") button:has-text("Ask Claude now")');
  await page.fill('input[aria-label="Article address"]', url);
  await page.click('.card:has-text("Draft from a link") button:has-text("Draft it")');
}

async function saveKey(page, key) {
  await page.fill('input[aria-label="Anthropic API key"]', key);
  await page.click('button:has-text("Save key"), button:has-text("Replace key")');
  return waitFlash(page, /./, 5000);
}

async function goKeyPage(page) {
  await nav(page, 'settings');
  await page.click('.rail button:has-text("Add key"), .rail button:has-text("Change key")');
  await settle(page);
}

// ---------- 1. First run, no key ----------
let mock = await startMock();
let { app, page, logs } = await launch({ mode, dirs, env: { STUDIO_ANTHROPIC_BASE_URL: mock.url } });
try {
  await shot(page, '01-first-run');
  const first = await text(page);
  check('First run', 'opens on the Claude (API key) page when no key is saved', first.includes('Anthropic API key') && first.includes('Save key'), '', '01-first-run');
  const active = await page.evaluate(() => Array.from(document.querySelectorAll('.navbtn.active')).map((b) => b.dataset.view));
  check('First run', 'the sidebar shows which page is open', active.length === 1 && active[0] !== 'drafts', `highlighted nav: ${JSON.stringify(active)}`, '01-first-run');
  check('First run', 'a default brand exists', await page.evaluate(() => document.querySelector('.persona-btn')?.innerText.includes('My brand')));

  for (const v of ['drafts', 'sources', 'topics', 'brandkit', 'schedule', 'settings', 'reads', 'playbook']) {
    await nav(page, v);
    await shot(page, `02-screen-${v}`, { full: true });
    const t = await text(page);
    check('Screens', `${v} opens without an error`, t.length > 50 && !/Couldn.t load/.test(t), '', `02-screen-${v}`);
  }
  check('Screens', 'no Coach page in the app', !(await page.$('.navbtn[data-view="coach"]')));
  await nav(page, 'drafts');
  const dt = await text(page);
  check('Copy', 'Drafts "how this works" step 3 describes the desktop app', !/scheduled task/.test(dt), 'Step 3 reads: "One click asks Claude to make the scheduled task." The app has no scheduled task; it runs while open.', '02-screen-drafts');
  check('Copy', 'Drafts step 1 counts the setup steps the app shows', !/Four short steps/.test(dt) , 'Step 1 says "Four short steps ... and whether it posts for you"; the app wizard shows three numbered steps and has no posting.', '02-screen-drafts');
  await nav(page, 'topics');
  check('Copy', 'Topics page does not point to the Coach page the app removed', !(await has(page, 'Coach page')), '"Changes to the voice and playbook always wait for your yes on the Coach page."', '02-screen-topics');

  // No key: every model action says to add one.
  await draftLinkNow(page);
  let seen = await waitFlash(page, /API key/i, 20000);
  await shot(page, '03-nokey-draft-link');
  check('No key', 'Draft from a link, Ask Claude now, says to add a key', seen.some((t) => /API key/i.test(t)), seen.join(' / '), '03-nokey-draft-link');
  check('No key', 'the link is still queued for later', await has(page, 'Queued') || await has(page, 'example.com'), '', '03-nokey-draft-link');
  await nav(page, 'schedule');
  await page.click('button:has-text("Run it now")');
  seen = await waitFlash(page, /API key/i, 10000);
  await shot(page, '03-nokey-run-now');
  check('No key', 'Schedule, Run it now, says to add a key', seen.some((t) => /API key/i.test(t)), seen.join(' / '), '03-nokey-run-now');

  // ---------- 2. API key entry ----------
  await goKeyPage(page);
  for (const [label, val, want] of [['empty', '', /Paste your/], ['too short', 'hello', /does not look like/], ['with a space', 'sk-ant-abc def-0000000000000000', /does not look like/], ['bad characters', 'sk-ant-<script>0000000000000000', /does not look like/]]) {
    seen = await saveKey(page, val);
    if (label === 'empty') await shot(page, '04-key-empty');
    check('API key', `refuses a key that is ${label}`, seen.some((t) => want.test(t)), seen.join(' / ') || '(no message)', label === 'empty' ? '04-key-empty' : null);
  }
  seen = await saveKey(page, FAKE_KEY);
  await settle(page, 800);
  await shot(page, '04-key-saved');
  check('API key', 'saves a well-formed key and says so', seen.some((t) => /Saved/.test(t)), seen.join(' / '), '04-key-saved');
  const keyFile = path.join(dirs.app, 'anthropic-key.bin');
  const raw = fs.existsSync(keyFile) ? fs.readFileSync(keyFile) : Buffer.alloc(0);
  check('API key', 'stores the key encrypted in the app folder, mode 600', raw.length > 0 && !raw.includes(Buffer.from(FAKE_KEY)) && (fs.statSync(keyFile).mode & 0o777) === 0o600, `${raw.length} bytes, mode ${raw.length ? (fs.statSync(keyFile).mode & 0o777).toString(8) : '-'}`);
  const leaks = [dirs.home, dirs.app].flatMap((d) => fs.readdirSync(d, { recursive: true }).map((f) => path.join(d, String(f))))
    .filter((f) => fs.statSync(f).isFile() && fs.readFileSync(f).includes(Buffer.from(FAKE_KEY)));
  check('API key', 'the plain key is in no file in the studio or app folders', !leaks.length, leaks.join(', '));
  await goKeyPage(page);
  await shot(page, '04-key-page-with-key');
  const kt = await text(page);
  check('API key', 'shows only a masked hint of the saved key', /A key ending \S+ is saved/.test(kt) && !kt.includes(FAKE_KEY) && (await page.inputValue('input[aria-label="Anthropic API key"]')) === '', (kt.match(/A key ending[^\n]*/) || [''])[0], '04-key-page-with-key');
  const keyInRenderer = await page.evaluate(async (k) => JSON.stringify(await window.studioDesktop.keyStatus()).includes(k), FAKE_KEY);
  check('API key', 'the page never receives the key itself', !keyInRenderer);
  await page.click('button:has-text("Remove key")');
  seen = await waitFlash(page, /Removed/, 5000);
  await shot(page, '04-key-removed');
  check('API key', 'Remove key deletes the stored key', !fs.existsSync(keyFile) && seen.some((t) => /Removed/.test(t)), seen.join(' / '), '04-key-removed');
  seen = await saveKey(page, FAKE_KEY);
  check('API key', 'a key can be saved again after removing', fs.existsSync(keyFile), seen.join(' / '));

  // ---------- 3. Setup wizard with the mock API ----------
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
  seen = await waitFlash(page, /Saved|suggestion|failed|refused/i, 60000);
  await settle(page, 1500);
  await shot(page, '05-setup-drafts', { full: true });
  check('Setup', 'Draft it for me returns Claude\'s setup drafts (mock API)', await has(page, 'first draft'), seen.join(' / '), '05-setup-drafts');
  check('Copy', 'setup drafts message is written for the person', !seen.some((t) => /suggestion\(s\)|for them to/.test(t)), seen.join(' / '), '05-setup-drafts');
  check('Setup', 'the brand name from step 1 is used', await has(page, 'Spoke and Chain'), (await text(page)).slice(0, 120), '05-setup-drafts');
  await page.click('button:has-text("Keep everything")');
  await settle(page, 1500);
  await page.click('main button:has-text("Next")');
  await settle(page, 1000);
  await shot(page, '05-setup-finish');
  await page.click('main button:has-text("Finish setup")');
  await settle(page, 1500);
  await shot(page, '05-setup-done');
  check('Setup', 'Finish setup leaves the wizard', !(await has(page, 'Finish setup')), '', '05-setup-done');

  // ---------- 4. Draft from a link, with the mock API ----------
  await draftLinkNow(page);
  seen = await waitFlash(page, /Done|draft|fail|error|couldn/i, 90000);
  await settle(page, 1500);
  await shot(page, '06-link-sources');
  check('Draft from a link', 'the link is fetched and queued', await has(page, 'example.com'), seen.join(' / '), '06-link-sources');
  await nav(page, 'drafts');
  await settle(page, 1000);
  await shot(page, '06-link-drafts', { full: true });
  const dtext = await text(page);
  check('Draft from a link', 'Ask Claude now produces drafts on the Drafts page (mock API)', /Draft \d/.test(dtext), seen.join(' / '), '06-link-drafts');
  // A link draft comes as three takes. "Use this one" keeps that take as a draft to review;
  // Approve then moves it to Approved.
  const pick = page.locator('main button:has-text("Use this one")').first();
  const approveBtn = page.locator('main').getByRole('button', { name: 'Approve', exact: true }).first();
  if (await pick.count()) {
    await pick.click();
    var pickSeen = await waitFlash(page, /./, 5000);
    await settle(page, 1200);
    await shot(page, '06-take-picked');
    const after = await text(page);
    check('Drafts', '"Use this one" keeps that take and sets the others aside', !/Use this one/.test(after) && /Skipped\s*[1-9]/.test(after), after.match(/To review\s*\d+\s*Approved\s*\d+\s*Skipped\s*\d+/)?.[0] || '', '06-take-picked');
  } else check('Drafts', 'a link draft offers takes to pick from', false, 'no "Use this one" button');
  if (await approveBtn.count()) {
    await approveBtn.click();
    seen = await waitFlash(page, /./, 6000);
    await settle(page, 1000);
    await shot(page, '06-draft-approved');
    check('Drafts', 'Approve moves a draft to Approved', /Approved\s*[1-9]/.test(await text(page)), (await text(page)).match(/To review\s*\d+\s*Approved\s*\d+/)?.[0] || '', '06-draft-approved');
    const said = [...(pickSeen || []), ...seen];
    check('Copy', 'pick and approve messages use the app\'s own words (Approve, Skip, the Approved tab)', !said.some((t) => /Passed tab|pass, edit or kill/.test(t)), said.join(' / '), '06-draft-approved');
  } else check('Drafts', 'Approve button present on a draft', false, 'no draft to approve');
  await settle(page, 600);
  await shot(page, '06-approved-tab'); // nothing left to review: a page shorter than the window
  const sp = await page.evaluate(() => ({ window: window.innerHeight, page: Math.round(document.body.getBoundingClientRect().height) }));
  check('Layout', 'the app background fills the window when a page is short', sp.page >= sp.window - 1, `window ${sp.window}px tall, page ${sp.page}px`, '06-approved-tab');
  check('Draft from a link', 'the mock received one setup call and at least one drafting call', mock.lines.some((l) => /takes/.test(l)), mock.lines.slice(1).join(' / '));

  // ---------- 5. Brand kit ----------
  await nav(page, 'brandkit');
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
    seen = await waitFlash(page, want, 15000);
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
  // Several at once, one good and one bad.
  await dropFiles(page, [fx.pdf, fx.gif]);
  seen = await waitFlash(page, /./, 10000);
  await shot(page, '07-kit-mixed-drop', { full: true });
  const names = await page.locator('.kit-file .nm').allInnerTexts();
  check('Brand kit', 'a mixed drop (one good, one bad) reports both', seen.some((t) => /animation\.gif/.test(t)) && seen.some((t) => /Added|brand-guidelines/.test(t)), `${seen.join(' / ')}; files now: ${names.join(', ')}`, '07-kit-mixed-drop');
  check('Brand kit', 'adding a file that is already in the kit does not add a second copy', names.filter((n) => n === 'brand-guidelines.pdf').length === 1, `brand-guidelines.pdf appears ${names.filter((n) => n === 'brand-guidelines.pdf').length} times`, '07-kit-mixed-drop');
  // Choose files, through the real button with the native dialog stubbed.
  await stubOpenDialog(app, [fx.md]);
  const n0 = await page.locator('.kit-file').count();
  await page.click('button:has-text("Choose files")');
  seen = await waitFlash(page, /Added|Only|Too/, 15000);
  await settle(page, 800);
  check('Brand kit', 'Choose files adds the picked file', (await page.locator('.kit-file').count()) === n0 + 1, seen.join(' / '));
  // Remove.
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
  // The kit goes with the next drafting call.
  const before = mock.lines.length;
  await draftLinkNow(page, 'https://example.org/');
  await waitFlash(page, /Done|draft|fail|error/i, 90000);
  const kitLine = mock.lines.slice(before).find((l) => /takes/.test(l)) || '';
  check('Brand kit', 'the next drafting call carries the kit (docs and images)', /kit: [1-9]\d* docs, [1-9]\d* images/.test(kitLine), kitLine || mock.lines.slice(before).join(' / '));

  // ---------- 6. Second persona ----------
  await page.click('.persona-btn');
  await settle(page, 300);
  await shot(page, '08-persona-menu');
  await page.click('.menu button:has-text("Add persona")');
  await settle(page);
  await page.fill('input[aria-label="Brand name"]', 'Night Market Bakery');
  await page.click('main button:has-text("Next")');
  await settle(page, 1200);
  await shot(page, '08-persona-second-setup');
  const btn = await page.locator('.persona-btn').innerText();
  check('Personas', 'Add persona creates and switches to the new brand', /Night Market Bakery/.test(btn), btn.replace(/\s+/g, ' '), '08-persona-second-setup');
  await nav(page, 'brandkit');
  await shot(page, '08-persona-second-kit');
  check('Personas', 'the second brand has its own, empty brand kit', (await page.locator('.kit-file').count()) === 0, '', '08-persona-second-kit');
  await dropFiles(page, [fx.png]);
  await waitFlash(page, /Added/, 10000);
  await nav(page, 'settings');
  check('Personas', 'the API key is shared across brands', /API key saved/.test(await text(page)), '', null);
  await page.click('.persona-btn');
  await settle(page, 300);
  await shot(page, '08-persona-menu-two');
  await page.click('.menu button:has-text("Spoke and Chain")');
  await settle(page, 1000);
  await nav(page, 'brandkit');
  await shot(page, '08-persona-switched-back');
  check('Personas', 'switching back shows the first brand\'s kit', (await page.locator('.kit-file').count()) === kitFiles, `${await page.locator('.kit-file').count()} files, expected ${kitFiles}`, '08-persona-switched-back');

  // ---------- 7. Settings that should survive a restart ----------
  await nav(page, 'schedule');
  await page.click('button[aria-label="Run while the app is open"]');
  seen = await waitFlash(page, /run on its own|off/i, 5000);
  await shot(page, '09-schedule-autorun-on');
  const prefs = JSON.parse(fs.readFileSync(path.join(dirs.app, 'prefs.json'), 'utf8'));
  check('Schedule', 'Run on its own switch saves to the app preferences', prefs.autorun === true, `${JSON.stringify(prefs)}; ${seen.join(' / ')}`, '09-schedule-autorun-on');
  await page.click('button:has-text("Once a day")').catch(() => {});
  await settle(page, 600);
  await nav(page, 'settings');
  await page.click('button[aria-label*="more" i], button:has-text("+")').catch(() => {});
  await settle(page, 600);
  await shot(page, '09-settings-changed', { full: true });
  await nav(page, 'topics');
  await page.fill('main input[type=text]', 'tune-ups').catch(() => {});
  await page.click('main button:has-text("Add")').catch(() => {});
  await settle(page, 800);
  await shot(page, '09-topics-added');
  check('Topics', 'a topic can be added', await has(page, 'tune'), '', '09-topics-added');
  // A narrow window.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));
  await nav(page, 'drafts');
  await settle(page, 600);
  await shot(page, '09-min-window-drafts');
  await nav(page, 'brandkit');
  await shot(page, '09-min-window-brandkit');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('Layout', 'no sideways scroll at the minimum window size (900x600)', !overflow, '', '09-min-window-brandkit');
} catch (e) {
  check('Run', 'walk finished without a script error', false, e.stack);
  await shot(page, 'zz-script-error').catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, `${mode}-console-1.log`), logs.join('\n') + '\n');
  await close(app);
}

// ---------- 8. Quit and relaunch ----------
({ app, page, logs } = await launch({ mode, dirs, env: { STUDIO_ANTHROPIC_BASE_URL: mock.url } }));
try {
  await shot(page, '10-relaunch');
  const t = await text(page);
  check('Relaunch', 'opens on Drafts (not the key page) once a key is saved', !t.includes('Paste an API key to start'), '', '10-relaunch');
  check('Relaunch', 'remembers the active brand', /Spoke and Chain/.test(await page.locator('.persona-btn').innerText()), await page.locator('.persona-btn').innerText());
  await nav(page, 'brandkit');
  await shot(page, '10-relaunch-kit');
  check('Relaunch', 'the brand kit is still there', (await page.locator('.kit-file').count()) > 0, '', '10-relaunch-kit');
  await nav(page, 'schedule');
  check('Relaunch', 'Run on its own is still on', (await page.locator('button[aria-label="Run while the app is open"]').getAttribute('aria-checked')) === 'true');
  await page.click('button[aria-label="Run while the app is open"]');
  await settle(page, 500);
  await nav(page, 'settings');
  check('Relaunch', 'the key is still saved', /API key saved/.test(await text(page)), '', null);
  await shot(page, '10-relaunch-settings', { full: true });
  await nav(page, 'drafts');
  await shot(page, '10-relaunch-drafts', { full: true });
  check('Relaunch', 'drafts from before are still there', /Approved\s*[1-9]|Draft \d/.test(await text(page)), '', '10-relaunch-drafts');
  // Closing the window keeps the app running (macOS); the Dock icon brings it back.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await new Promise((r) => setTimeout(r, 800));
  const alive = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => -1);
  check('Relaunch', 'closing the window keeps the app running', alive === 0, `windows after close: ${alive}`);
  await app.evaluate(({ app: a }) => a.emit('activate'));
  const w2 = await app.waitForEvent('window', { timeout: 15000 }).catch(() => null);
  if (w2) { await w2.waitForSelector('.navbtn'); await w2.waitForTimeout(800); await w2.screenshot({ path: path.join(OUT, `${mode}-10-reopened-window.png`) }); }
  check('Relaunch', 'clicking the Dock icon reopens the window', !!w2, '', w2 ? '10-reopened-window' : null);
} catch (e) {
  check('Run', 'relaunch finished without a script error', false, e.stack);
} finally {
  fs.writeFileSync(path.join(OUT, `${mode}-console-2.log`), logs.join('\n') + '\n');
  await close(app);
  mock.stop();
}

// ---------- 9. Bad key, no network, real API with a made-up key ----------
async function errorRun(label, env, want, name) {
  const r = await launch({ mode, dirs, env });
  try {
    await draftLinkNow(r.page, 'https://example.net/');
    const s = await waitFlash(r.page, want, 120000);
    await r.page.waitForTimeout(300);
    await shot(r.page, name);
    check('API errors', label, s.some((t) => want.test(t)), s.join(' / ') || '(no message)', name);
    return s;
  } catch (e) { check('API errors', label, false, e.message); } finally { await close(r.app); }
}
const refusing = await startRefusing(401);
await errorRun('a refused (bad) key says so in plain words', { STUDIO_ANTHROPIC_BASE_URL: refusing.url }, /refused the API key/, '11-bad-key');
check('API errors', 'the bad-key server received the key (as a header)', refusing.seen.some((s) => s.key !== 'missing'), JSON.stringify(refusing.seen.slice(0, 2)));
refusing.stop();
const t0 = Date.now();
await errorRun('no network to the API says so', { STUDIO_ANTHROPIC_BASE_URL: DEAD_URL }, /reach Anthropic/, '11-no-network');
check('API errors', 'the no-network error arrives within 30 seconds', Date.now() - t0 < 30000, `${Math.round((Date.now() - t0) / 1000)} s`);
const rl = await startRefusing(429, 18789);
await errorRun('rate limiting says to try again', { STUDIO_ANTHROPIC_BASE_URL: rl.url }, /rate limiting/, '11-rate-limit');
rl.stop();
if (process.env.QA_REAL_API !== '0') await errorRun('the real Anthropic API refuses a made-up key with the bad-key message', {}, /refused the API key/, '11-real-api-fake-key');

fs.writeFileSync(path.join(OUT, `${mode}-results.json`), JSON.stringify({ mode, at: new Date().toISOString(), results }, null, 2) + '\n');
console.log(`\n${results.filter((r) => r.ok).length} passed, ${results.filter((r) => !r.ok).length} failed. Data folder: ${dirs.base}`);
