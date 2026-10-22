// Runs the real board scripts against a DOM shim and a simulated host wired to the real tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { makeDom } from './dom-shim.js';
import { tempHome } from './helpers.js';
import { seed } from '../dev/seed.mjs';
import { makeContext } from '../server/lib/state.js';
import { callTool } from '../server/lib/tools.js';
import { PLUGIN_ROOT } from '../server/lib/config.js';
import { BOARD_SCRIPTS, boardHtml } from '../server/lib/rpc.js';

const tick = () => new Promise((r) => setTimeout(r, 5));
async function settle(n = 20) { for (let i = 0; i < n; i++) await tick(); }

async function boot({ fetchImpl } = {}) {
  const home = tempHome();
  seed(home);
  const ctx = makeContext({ home, fetchImpl });
  const { document } = makeDom();
  const sent = [];
  const listeners = [];
  const parent = {
    postMessage: async (m) => {
      sent.push(m);
      const reply = (result) => listeners.forEach((f) => f({ source: parent, data: { jsonrpc: '2.0', id: m.id, result } }));
      if (m.method === 'ui/initialize') reply({ protocolVersion: '2026-01-26', hostContext: { theme: 'dark', styles: { variables: { '--color-text-primary': '#fff' } } } });
      else if (m.method === 'tools/call') reply(await callTool(ctx, m.params.name, m.params.arguments));
      else if (m.method === 'ui/message' || m.method === 'ui/open-link' || m.method === 'ui/request-display-mode') reply(m.method === 'ui/request-display-mode' ? { mode: m.params.mode } : {});
      else if (m.method === 'ui/notifications/initialized') {
        const r = await callTool(ctx, 'studio_board', {});
        listeners.forEach((f) => f({ source: parent, data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: r } }));
      }
    },
  };
  const win = {
    document, parent, innerWidth: 640, navigator: { clipboard: { writeText: async (t) => { win.copied = t; } } },
    addEventListener: (t, f) => { if (t === 'message') listeners.push(f); },
    requestAnimationFrame: (f) => setTimeout(f, 0), clearTimeout,
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); if (ms > 100) t.unref(); return t; }, ResizeObserver: class { observe() {} },
    Promise, Map, Set, Object, Array, Date, Math, Number, String, JSON, Error, console, STUDIO_SKINS: ['light'],
  };
  win.window = win;
  vm.createContext(win);
  const ui = (f) => fs.readFileSync(path.join(PLUGIN_ROOT, 'server', 'ui', f), 'utf8');
  for (const f of ['board-bridge.js', ...BOARD_SCRIPTS]) vm.runInContext(ui(f), win, { filename: f });
  await settle();
  const nav = async (v) => { await document.querySelectorAll('.navbtn').find((x) => x.dataset.view === v).click(); await settle(); };
  return { ctx, document, sent, win, nav, view: () => document.getElementById('view') };
}

const isBtn = (e) => e.tagName === 'BUTTON';
const buttons = (root, text) => root.findAll((e) => isBtn(e) && (e.textContent.trim() === text || e.textContent.trim().startsWith(text) || e.attrs['aria-label'] === text));
// Exact text or label first, then a prefix ("Copy ·", "None of these…").
const button = (root, text) => root.find((e) => isBtn(e) && (e.textContent.trim() === text || e.attrs['aria-label'] === text)) || buttons(root, text)[0];
const input = (root, aria) => root.find((e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName) && e.attrs['aria-label'] === aria);
const drafts = (b) => b.ctx.store.read('drafts', []);

test('the board handshakes, keeps its own light skin and renders the drafts feed', async () => {
  const b = await boot();
  assert.equal(b.sent[0].method, 'ui/initialize');
  assert.equal(b.sent[0].params.protocolVersion, '2026-01-26');
  assert.ok(b.sent.some((m) => m.method === 'ui/notifications/initialized'));
  assert.equal(b.document.documentElement.dataset.theme, 'dark');
  assert.equal(b.document.documentElement.dataset.skin, 'light', 'no dark skin file, so it stays light');
  const v = b.view().textContent;
  assert.match(v, /Four kilometres of kerb/);
  assert.match(v, /Pick the one you'd post/);
  assert.match(v, /Best bet/);
  assert.match(v, /Northwind Bicycles@northwind-bicycles/, 'posts read like a feed: name and handle');
  assert.match(v, /Check the number: 7 isn't in the story/, 'lint flags as friendly chips');
  assert.match(b.document.getElementById('counter').textContent, /of 10 today/);
  assert.match(b.document.getElementById('jobs').textContent, /waiting for Claude/);
  assert.match(b.document.getElementById('persona').textContent, /Northwind Bicycles/);
  assert.match(v, /Your brands/);
  assert.match(v, /Fernhollow Bakery/);
  assert.ok(b.sent.some((m) => m.method === 'ui/notifications/size-changed'));
});

test('pick, approve, skip and copy go through studio_act and re-render', async () => {
  const b = await boot();
  await button(b.view(), 'Use this one').click();
  await settle();
  assert.equal(drafts(b).find((d) => d.id === 1).status, 'pending');
  assert.equal(drafts(b).find((d) => d.id === 2).status, 'unpicked');
  await button(b.view(), 'Approve').click();
  await settle();
  assert.ok(drafts(b).some((d) => d.status === 'passed' && d.decided_at && Date.now() - Date.parse(d.decided_at) < 60e3));
  await button(b.view(), 'Skip').click();
  await settle();
  assert.ok(b.sent.filter((m) => m.method === 'tools/call' && m.params.name === 'studio_act').length >= 3);
  await button(b.view(), 'Approved').click();
  await settle();
  const copy = button(b.view(), 'Copy ·');
  assert.match(copy.textContent, /Copy · (X|LinkedIn) · \d+\/\d+/);
  await copy.click();
  assert.ok(b.win.copied && b.win.copied.length > 10);
});

test('edit in place with a live character ring, then save and approve', async () => {
  const b = await boot();
  const before = drafts(b).filter((d) => d.status === 'pending').length;
  await button(b.view(), 'Edit').click(); await settle();
  const ta = input(b.view(), 'Edit the post');
  ta.value = 'x'.repeat(300);
  await ta.fire('input');
  assert.ok(b.view().find((e) => e.attrs['aria-label'] === '300 of 280 characters' || e.attrs['aria-label'] === '300 of 3000 characters'), 'the ring follows the text');
  ta.value = 'Shorter, better, ours.';
  await button(b.view(), 'Save & approve').click(); await settle();
  assert.ok(drafts(b).some((d) => d.final_text === 'Shorter, better, ours.' && d.status === 'edited'));
  assert.equal(drafts(b).filter((d) => d.status === 'pending').length, before - 1);
});

test('none of these + try again, bring back with a reason, bring back an expired draft', async () => {
  const b = await boot();
  await button(b.view(), 'None of these…').click();
  await settle();
  await button(b.view(), 'Too generic').click();
  await button(b.view(), 'None, try again').click();
  await settle();
  assert.ok(b.ctx.store.read('jobs', []).some((j) => j.kind === 'redo' && j.note === 'too generic'));
  await button(b.view(), 'Skipped').click(); await settle();
  await button(b.view(), 'Bring back').click(); await settle();
  input(b.view(), 'Why bring it back').value = 'it grew on me';
  await button(b.view(), 'Bring it back').click(); await settle();
  assert.ok(b.ctx.store.read('reversals', []).some((r) => r.reason === 'it grew on me'));
  await button(b.view(), 'Expired').click(); await settle();
  await button(b.view(), 'Bring back').click(); await settle();
  assert.ok(drafts(b).some((d) => d.resurrected_at));
});

test('the persona switcher switches, and Add persona opens the setup wizard', async () => {
  const b = await boot();
  const persona = () => b.document.getElementById('persona');
  await button(persona(), 'NB').click(); await settle();
  await buttons(persona(), 'FB').find((x) => /Fernhollow/.test(x.textContent)).click(); await settle();
  assert.equal(b.ctx.slug, 'fernhollow-bakery');
  assert.match(b.view().textContent, /Fernhollow Bakery@fernhollow-bakery/);
  assert.match(b.view().textContent, /bake to the queue/);
  await button(persona(), 'FB').click(); await settle();
  await button(persona(), 'Add persona').click(); await settle();
  assert.match(b.view().textContent, /Add a brand.*What’s the brand called\?/);
  assert.equal(b.ctx.personas.list().length, 2, 'nothing is created until step 1 is sent');
  input(b.view(), 'Brand name').value = 'Juniper Lane Books';
  await button(b.view(), 'Next').click(); await settle();
  assert.equal(b.ctx.slug, 'juniper-lane-books');
  assert.match(b.view().textContent, /A few questions about Juniper Lane Books/);
  // Leave halfway: the Drafts page offers it again, at the same step.
  await b.nav('drafts');
  const v = b.view().textContent;
  assert.match(v, /Here's how this works.*Set up the brand/);
  await button(b.view(), 'Continue (step 2 of 4)').click(); await settle();
  assert.match(b.view().textContent, /A few questions about Juniper Lane Books/);
});

test('Sources: add a feed, pause, re-file and remove it, and draft from a link', async () => {
  const feed = '<rss><channel><title>Example Lanes Weekly</title><item><title>A</title><link>https://lanes.example.com/a</link></item></channel></rss>';
  const article = '<html><head><title>Ten years of cargo counts</title></head><body><article><p>Cargo bikes now make most of the downtown parcel rounds, the survey says.</p></article></body></html>';
  const pages = { 'https://lanes.example.com/feed': feed, 'https://read.example.com/cargo': article };
  const b = await boot({ fetchImpl: async (u) => (u in pages ? { ok: true, status: 200, headers: new Map(), text: async () => pages[u] } : { ok: false, status: 404, headers: new Map() }) });
  await b.nav('sources');
  assert.match(b.view().textContent, /Example City Cycling News/);
  assert.match(b.view().textContent, /Not responding/);
  assert.match(b.view().textContent, /Paused/);
  const addBtn = (aria) => input(b.view(), aria).parent.find(isBtn);
  input(b.view(), 'Source address').value = 'https://lanes.example.com/feed';
  await addBtn('Source address').click(); await settle();
  const feeds = () => b.ctx.store.readFile('sources.json');
  assert.match(feeds(), /Example Lanes Weekly/);
  await button(b.view(), 'Pause Example Lanes Weekly').click(); await settle();
  assert.match(feeds(), /"paused": true/);
  const sel = input(b.view(), 'Topic for Example Lanes Weekly');
  await sel.fire('change', { target: { value: 'cargo' } }); await settle();
  assert.match(JSON.stringify(JSON.parse(feeds()).feeds.find((f) => f.name === 'Example Lanes Weekly')), /"topic":"cargo"/);
  const rm = button(b.view(), 'Remove Example Lanes Weekly');
  await rm.click(); await rm.click(); await settle();
  assert.doesNotMatch(feeds(), /Example Lanes Weekly/);
  input(b.view(), 'Article address').value = 'https://read.example.com/cargo';
  await button(b.view(), 'Draft it').click(); await settle();
  assert.ok(b.ctx.store.read('jobs', []).some((j) => j.from_link && j.status === 'queued' && j.id > 2));
  assert.match(b.view().textContent, /Ten years of cargo counts/);
  input(b.view(), 'Source address').value = 'http://insecure.example.com/feed';
  await addBtn('Source address').click(); await settle();
  assert.match(b.document.getElementById('flash').textContent, /https/);
});

test('Topics: add, weight and remove topics; learned interests explain themselves', async () => {
  const b = await boot();
  await b.nav('topics');
  const v = b.view().textContent;
  assert.match(v, /Learned from your verdicts/);
  assert.match(v, /Posts about policy/);
  assert.match(v, /You approved 0 of 6/);
  assert.match(v, /How it picks your drafts/);
  input(b.view(), 'New topic').value = 'E-bike batteries';
  await button(b.view(), 'Add').click(); await settle();
  assert.match(b.ctx.store.readFile('beat.json'), /e-bike-batteries/);
  const seg = b.view().find((e) => e.attrs['aria-label'] === 'How much e bike batteries');
  await seg.find((e) => e.textContent === 'More').click(); await settle();
  assert.equal(JSON.parse(b.ctx.store.readFile('beat.json')).weights['e-bike-batteries'], 3);
  const rm = button(b.view(), 'Remove e bike batteries');
  await rm.click(); await rm.click(); await settle();
  assert.doesNotMatch(b.ctx.store.readFile('beat.json'), /e-bike-batteries/);
});

test('Schedule: presets and release times are one click; the Cowork text is honest and copyable', async () => {
  const b = await boot();
  await b.nav('schedule');
  assert.match(b.view().textContent, /The studio can’t start itself/);
  assert.match(b.view().textContent, /Run the Fishbowl Studio daily run\./);
  await button(b.view(), 'Twice a day').click(); await settle();
  assert.equal(b.ctx.settings().fetch_every, 'twice_daily');
  assert.match(b.view().textContent, /Fishbowl Studio run 2/);
  await button(b.view(), '9:00').click(); await settle();
  assert.deepEqual(b.ctx.settings().release_hours, [8, 9, 12, 16, 20]);
  await button(b.view(), 'Copy all').click();
  assert.match(b.win.copied, /repeat Daily at 07:00/);
});

test('Settings: switches, steppers and segmented choices save on click; Reads and Playbook still act', async () => {
  const b = await boot();
  await b.nav('settings');
  await button(b.view(), 'More: Drafts a day').click(); await settle();
  assert.equal(JSON.parse(b.ctx.store.readFile('settings.json')).daily_cap, 11);
  await b.view().find((e) => e.attrs['aria-label'] === 'Takes per story').find((e) => e.textContent === '2').click(); await settle();
  assert.equal(b.ctx.settings().takes_per_item, 2);
  await button(b.view(), 'X drafts').click(); await settle();
  assert.equal(b.ctx.settings().platforms.x.enabled, false);
  await button(b.view(), 'LinkedIn drafts').click(); await settle();
  assert.equal(b.ctx.settings().platforms.linkedin.enabled, true, 'the last platform stays on');
  assert.match(b.document.getElementById('flash').textContent, /at least one platform/);
  input(b.view(), 'Example post').value = 'Every bike that leaves the bench gets a test ride round the block.';
  await button(b.view(), 'Add example').click(); await settle();
  assert.match(b.ctx.store.readFile('voice-samples.json'), /test ride/);
  await button(b.view(), 'Remove game-changer').click(); await settle();
  assert.doesNotMatch(b.ctx.store.readFile('settings.json'), /game-changer/);
  await button(b.view(), 'Change the brand voice').click(); await settle();
  assert.ok(b.sent.some((m) => m.method === 'ui/message'));
  await b.nav('reads');
  assert.match(b.view().textContent, /interest 9\/10/);
  assert.match(b.view().textContent, /From wandering/);
  await button(b.view(), 'Draft this').click(); await settle();
  assert.ok(b.ctx.store.read('jobs', []).some((j) => j.kind === 'draft_item' && !j.from_link));
  await b.nav('playbook');
  assert.match(b.view().textContent, /Proposed changes \(4\)/);
  await button(b.view(), 'Accept').click(); await settle();
  assert.match(b.ctx.store.readFile('playbook.md'), /practical consequence/);
});

test('component CSS takes every colour from the skin; the board ships every skin file', () => {
  const css = fs.readFileSync(path.join(PLUGIN_ROOT, 'server', 'ui', 'board.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const literal = css.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(white|black|red|green|blue|gray|grey)\b(?![-\w])/gi);
  assert.equal(literal, null, `literal colours in board.css: ${literal}`);
  const html = boardHtml();
  assert.match(html, /:root, :root\[data-skin="light"\]/);
  assert.match(html, /window\.STUDIO_SKINS = \["light","dark"\]/);
  assert.match(html, /:root\[data-skin="dark"\]/);
  // Dark mode must not leave a light colour behind: every colour token in light.css is redefined in dark.css.
  const skin = (f) => fs.readFileSync(path.join(PLUGIN_ROOT, 'server', 'ui', 'skins', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const colourTokens = (css) => new Set([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].filter(([, , v]) => /#|rgba?\(|shadow/.test(v) || /^--shadow/.test(v)).map(([, k]) => k));
  const dark = colourTokens(skin('dark.css'));
  const missing = [...colourTokens(skin('light.css'))].filter((k) => !dark.has(k));
  assert.deepEqual(missing, [], `dark.css is missing colour tokens: ${missing}`);
  assert.doesNotMatch(html, /__(CSS|SKINS|BRIDGE|VIEWS)__/);
});

test('Skip asks why with one optional tap; the reason is stored and shown on the Skipped tab', async () => {
  const b = await boot();
  const pending = drafts(b).find((d) => d.status === 'pending' && !d.rewriting);
  await button(b.view(), 'Skip').click(); await settle();
  const ask = b.view().find((e) => e.attrs['aria-label'] === 'Why did you skip it?');
  assert.ok(ask, 'the why strip appears');
  await button(ask, 'Too salesy').click(); await settle();
  const killed = drafts(b).find((d) => d.status === 'killed' && d.decided_at && Date.now() - Date.parse(d.decided_at) < 60e3);
  assert.equal(killed.kill_reason, 'too_salesy');
  assert.ok(pending);
  assert.ok(!b.view().find((e) => e.attrs['aria-label'] === 'Why did you skip it?'), 'and goes away');
  await button(b.view(), 'Skipped').click(); await settle();
  assert.match(b.view().textContent, /Skipped as: Too salesy/);
  assert.match(b.view().textContent, /Skipped as: Off-brand/, 'seeded reasons show too');
  // Ignoring the question is fine: the skip stands without a reason.
  await button(b.view(), 'To review').click(); await settle();
  await button(b.view(), 'Skip').click(); await settle();
  await button(b.view(), 'No reason').click(); await settle();
  assert.ok(!b.view().find((e) => e.attrs['aria-label'] === 'Why did you skip it?'));
});

test('Coach: the weekly report, what is waiting with its why, and their tap applies it', async () => {
  const b = await boot();
  await b.nav('coach');
  const v = b.view().textContent;
  assert.match(v, /Week of \d{4}-\d{2}-\d{2}/);
  assert.match(v, /What’s working.*Cargo bike posts: you approved 3 of 3/);
  assert.match(v, /Try next week.*Open on the concrete detail/);
  assert.match(v, /Waiting for your yes \(4\)/);
  assert.match(v, /From your edits.*Open with a plain statement, not a question.*Why: You cut the opening question in 5 of your last 7 edits/);
  assert.match(v, /Why you skipped \(30 days\)/);
  assert.match(v, /Sources that keep losing.*Example Transport Policy Notes.*0 of 4 drafts from it approved/);
  assert.match(v, /Earlier weeks/);
  assert.equal(b.document.getElementById('badge-coach').textContent, '4');
  const row = b.view().findAll((e) => e.className === 'row-item').find((r) => /plain statement/.test(r.textContent));
  await button(row, 'Accept').click(); await settle();
  assert.match(b.ctx.store.readFile('playbook.md'), /- Open with a plain statement, not a question/);
  const pause = b.view().findAll((e) => e.className === 'row-item').find((r) => /Example Transport Policy Notes/.test(r.textContent));
  await button(pause, 'Pause it').click(); await settle();
  assert.equal(JSON.parse(b.ctx.store.readFile('sources.json')).feeds.find((f) => f.name === 'Example Transport Policy Notes').paused, true, 'paused by their tap');
});

test('Sources: every kind, records, suggestions they add or dismiss, and the login and browser states', async () => {
  const b = await boot({ fetchImpl: async () => ({ ok: false, status: 404, headers: new Map() }) });
  await b.nav('sources');
  let v = b.view().textContent;
  assert.match(v, /Suggested sources \(2\)/);
  assert.match(v, /Daily news: cycling-policy\.example\.org.*Found in your searches: 3 good results/);
  assert.match(v, /Watch @example_cargo on X.*Claude suggested it/);
  assert.match(v, /Keeps losing: 0 of 4 drafts from it approved in the last 6 weeks\. Pause it\?/);
  assert.match(v, /4 of 4 approved/);
  assert.match(v, /r\/examplebikecommute/);
  assert.match(v, /Accounts you watch \(3\).*@example_lanes.*Asks to log in.*Trending on X/);
  assert.match(v, /Saved searches \(2\).*e-bike regulation/);
  assert.equal(b.document.getElementById('badge-sources').textContent, '2');
  const sug = b.view().findAll((e) => e.className === 'row-item').find((r) => /example_cargo/.test(r.textContent));
  await button(sug, 'Add').click(); await settle();
  assert.ok(JSON.parse(b.ctx.store.readFile('sources.json')).watch.some((w) => w.handle === '@example_cargo'), 'added on their tap');
  const dead = b.view().findAll((e) => e.className === 'row-item').find((r) => /cycling-policy/.test(r.textContent));
  await button(dead, 'Add').click(); await settle();
  assert.match(b.view().textContent, /Last try: Couldn't add it: HTTP 404/);
  await button(b.view().findAll((e) => e.className === 'row-item').find((r) => /cycling-policy/.test(r.textContent)), 'Dismiss').click(); await settle();
  assert.doesNotMatch(b.view().textContent, /Suggested sources/);
  // Add a search and an account from the board.
  const kinds = b.view().find((e) => e.attrs['aria-label'] === 'What kind of source');
  await button(kinds, 'Search').click(); await settle();
  input(b.view(), 'Saved search').value = 'cargo bike school run';
  await input(b.view(), 'Saved search').parent.find(isBtn).click(); await settle();
  await button(b.view().find((e) => e.attrs['aria-label'] === 'What kind of source'), 'X or LinkedIn').click(); await settle();
  input(b.view(), 'Account to watch').value = 'https://evil.example/x.com/a';
  await input(b.view(), 'Account to watch').parent.find(isBtn).click(); await settle();
  assert.match(b.document.getElementById('flash').textContent, /only x\.com and linkedin\.com/);
  const src = JSON.parse(b.ctx.store.readFile('sources.json'));
  assert.ok(src.searches.some((s) => s.q === 'cargo bike school run'));
  await button(b.view(), 'Pause e-bike regulation').click(); await settle();
  assert.equal(JSON.parse(b.ctx.store.readFile('sources.json')).searches.find((s) => s.q === 'e-bike regulation').paused, true);
  // The other brand ran without a browser.
  await b.ctx.personas.switch('fernhollow-bakery');
  await b.nav('sources');
  v = b.view().textContent;
  assert.match(v, /couldn’t use its browser.*web search instead/);
  assert.match(v, /Example Stone Mill.*Read by web search/);
});

test('Settings: account slots ask Claude to walk them through signing in and record only that', async () => {
  const b = await boot();
  await b.nav('settings');
  let v = b.view().textContent;
  assert.match(v, /Accounts.*never stores a password\. It posts for you only on an account where you turn “Post for me” on/);
  assert.match(v, /X.*Connected/);
  assert.match(v, /Reading signed in: not yet · Posting for you: off/);
  const li = b.view().findAll((e) => e.classList.contains('row-item')).find((r) => /LinkedIn/.test(r.textContent) && /Add account/.test(r.textContent));
  await button(li, 'Add account').click(); await settle();
  const msg = b.sent.filter((m) => m.method === 'ui/message').pop();
  assert.match(JSON.stringify(msg.params), /signing in to linkedin\.com myself/);
  assert.equal(b.ctx.store.read('accounts', []).find((a) => a.type === 'linkedin').status, 'connected_by_prompt');
});

test('Topics and Reads explain what moved stories up or down', async () => {
  const b = await boot();
  await b.nav('topics');
  const v = b.view().textContent;
  assert.match(v, /What it drafts first/);
  assert.match(v, /Stories about cargo.*Because: You approved 3 of 3 posts about cargo/);
  assert.match(v, /Stories about policy.*Because: You skipped 2 policy posts as "wrong topic"/);
  assert.match(v, /From your edits.*You cut the opening question in 5 of your last 7 edits/);
  await b.nav('reads');
  assert.match(b.view().textContent, /Moved up: You approved 3 of 3 posts about cargo/);
  assert.match(b.view().textContent, /Search result/);
});

test('Wizard on the board: brand, questions, Claude drafts in the chat, they keep, edit and drop, posting, schedule', async () => {
  const feed = '<rss><channel><title>Example Paper Trade News</title><item><title>A</title><link>https://paper.example.com/a</link></item></channel></rss>';
  const b = await boot({ fetchImpl: async (u) => (u === 'https://paper.example.com/feed' ? { ok: true, status: 200, headers: new Map(), text: async () => feed } : { ok: false, status: 404, headers: new Map() }) });
  await button(b.document.getElementById('persona'), 'NB').click(); await settle();
  await button(b.document.getElementById('persona'), 'Add persona').click(); await settle();
  input(b.view(), 'Brand name').value = 'Juniper Lane Books';
  input(b.view(), 'Website or LinkedIn page').value = 'https://www.linkedin.com/company/example-juniper-lane/';
  await button(b.view(), 'Next').click(); await settle();
  // Step 2: plain questions with an example under each; any can be skipped.
  let v = b.view().textContent;
  assert.match(v, /Who are your posts for\?e\.g\./);
  assert.match(v, /Anything it should never post about\?/);
  input(b.view(), 'Who are your posts for?').value = 'Readers in the neighbourhood and the book club';
  await input(b.view(), 'Who are your posts for?').fire('change'); await settle();
  assert.equal(b.ctx.store.read('wizard', {}).answers.audience, 'Readers in the neighbourhood and the book club', 'saved as they go');
  input(b.view(), 'What should it talk about?').value = 'new books, author events, the paper trade';
  await button(b.view(), 'Draft it for me').click(); await settle();
  const msg = b.sent.filter((m) => m.method === 'ui/message').pop();
  assert.match(JSON.stringify(msg.params), /Draft the Fishbowl Studio setup for Juniper Lane Books \(persona juniper-lane-books\)/, 'handed to Claude like Add account');
  assert.match(b.view().textContent, /Claude is drafting Juniper Lane Books.*Waiting for Claude in the chat/);
  // Claude, in the chat.
  const brief = (await callTool(b.ctx, 'studio_wizard_brief', {})).content[0].text;
  assert.match(brief, /LinkedIn pages need a login/);
  await callTool(b.ctx, 'studio_wizard_save', { brief_id: brief.match(/brief_id: "([0-9a-f]+)"/)[1],
    voice: '## Who we are\nAn independent bookshop on Juniper Lane.\n\n## Voice\nBookish and warm, never twee.\n\n## Never\nNo spoilers.',
    playbook: ['Name the book in the first line', 'One recommendation per post'], topics: ['new books', 'author events'], off_limits: ['spoilers'], audience: ['Neighbours who read'],
    sources: [{ kind: 'site', url: 'https://paper.example.com/feed', topic: 'new-books', reason: 'trade news' }] });
  await button(b.view(), 'Check now').click(); await settle();
  v = b.view().textContent;
  assert.match(v, /Here’s a first draft of Juniper Lane Books/);
  assert.match(v, /VoiceHow the brand sounds/);
  assert.match(v, /Starter sources.*Daily news: paper\.example\.com/);
  assert.equal(b.ctx.store.readFile('voice.md'), null, 'nothing written yet');
  // Edit a topic, keep it; drop a bullet; keep the voice; add the source.
  const topic = input(b.view(), 'Topic: new books');
  topic.value = 'New fiction';
  await button(topic.parent, 'Keep').click(); await settle();
  assert.deepEqual(JSON.parse(b.ctx.store.readFile('beat.json')).topics, ['new-fiction']);
  await button(input(b.view(), 'Playbook: One recommendation per post').parent, 'Drop').click(); await settle();
  await button(input(b.view(), 'Voice').parent, 'Keep').click(); await settle();
  assert.match(b.ctx.store.readFile('voice.md'), /Bookish and warm/);
  const src = b.view().findAll((e) => e.classList.contains('row-item')).find((r) => /paper\.example\.com/.test(r.textContent));
  await button(src, 'Add').click(); await settle();
  assert.match(b.ctx.store.readFile('sources.json'), /Example Paper Trade News/);
  assert.match(b.view().textContent, /Dropped.*Kept your version/);
  await button(b.view(), 'Keep everything').click(); await settle();
  assert.equal(b.ctx.store.read('proposals', []).filter((p) => p.status === 'open').length, 0);
  // Step 4: Post for me, per account, off.
  await button(b.view(), 'Next').click(); await settle();
  v = b.view().textContent;
  assert.match(v, /Should Claude post for you\?/);
  assert.match(v, /XNot connectedConnectPost for meConnect the account first\. Off until you turn it on/);
  await button(b.view(), 'Next').click(); await settle();
  // Finish: one click asks Claude to make the scheduled task.
  assert.match(b.view().textContent, /Make it run on its own.*Fishbowl Studio daily run/);
  await button(b.view(), 'Set it up for me').click(); await settle();
  assert.match(JSON.stringify(b.sent.filter((m) => m.method === 'ui/message').pop().params), /create_scheduled_task.*cron \\"0 7 \* \* 1-5\\"/);
  await button(b.view(), 'Finish setup').click(); await settle();
  assert.equal(b.ctx.settings().setup_complete, true);
  assert.match(b.view().textContent, /Today's drafts for Juniper Lane Books/);
});

test('Wizard: answers survive closing it; a re-run with drafts waiting opens at the review step', async () => {
  const b = await boot();
  await b.ctx.personas.switch('fernhollow-bakery');
  await b.nav('drafts');
  assert.match(b.view().textContent, /Finish setting up Fernhollow Bakery.*step 3 of 4/);
  await button(b.view(), 'Pick up where you left off').click(); await settle();
  let v = b.view().textContent;
  assert.match(v, /Here’s a first draft of Fernhollow Bakery/);
  assert.match(v, /Off limitsWhat it never posts about/);
  assert.match(v, /grain-and-mill\.example\.org.*Milling and heritage grain news/);
  await button(b.view(), 'Back').click(); await settle();
  assert.equal(input(b.view(), 'Who are your posts for?').value, 'Neighbours who buy bread twice a week, and cafe owners');
  assert.equal(input(b.view(), 'Anything it should never post about?').value, '', 'skipped stays skipped');
  // The same drafts wait on Coach too: one flow, not two.
  await b.nav('coach');
  assert.match(b.view().textContent, /From setup/);
});

test('Posting on the board: missed and failed posts are never silent; approve to post; the switch warns first', async () => {
  const b = await boot();
  const banner = b.document.getElementById('posting');
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /2 approved posts didn’t go out \(1 missed, 1 failed\)\. Nothing is retried by itself\./);
  await button(banner, 'See which').click(); await settle();
  let v = b.view().textContent;
  assert.match(v, /Missed the 16:00 slotNothing ran between 16:00 and 17:00: your computer was asleep or Claude was closed/);
  assert.match(v, /Didn’t postYou weren't signed in/);
  assert.match(v, /Claude posts this to X at \d\d:00/);
  assert.match(v, /Posted to X by Claude/);
  // Their choice for each: another slot, or copy it themselves.
  const missed = b.view().findAll((e) => e.classList.contains('post-problem')).find((x) => /Missed/.test(x.textContent));
  await button(missed, 'Try the next slot').click(); await settle();
  const failed = b.view().findAll((e) => e.classList.contains('post-problem')).find((x) => /Didn’t post/.test(x.textContent));
  await button(failed, 'I’ll copy it myself').click(); await settle();
  assert.equal(b.document.getElementById('posting').hidden, true);
  assert.equal(b.ctx.store.read('posts', []).filter((p) => p.status === 'scheduled').length, 2);
  // To review: an X draft says what Approve will do.
  await button(b.view(), 'To review').click(); await settle();
  assert.ok(buttons(b.view(), 'Approve & post').length, 'X drafts post when approved');
  // Settings: Threads was on and is off; turning it on shows the warning first.
  await b.nav('settings');
  const threads = () => b.view().findAll((e) => e.classList.contains('row-item')).find((r) => /^Threads/.test(r.textContent.replace(/^T/, 'T')) && /Posting for you/.test(r.textContent));
  assert.match(threads().textContent, /Off since/);
  await button(threads(), 'Post for me on Threads').click(); await settle();
  assert.match(threads().textContent, /Before you turn this on.*Meta.*Your computer has to be awake.*turn it off any time/);
  assert.equal(b.ctx.store.read('accounts', []).find((a) => a.type === 'threads').posting.on, false, 'not yet');
  await button(threads(), 'Turn it on').click(); await settle();
  assert.equal(b.ctx.store.read('accounts', []).find((a) => a.type === 'threads').posting.on, true);
  // Schedule now includes the posting task.
  await b.nav('schedule');
  assert.match(b.view().textContent, /Fishbowl Studio posting.*Run the Fishbowl Studio posting\./);
});
