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

test('the persona switcher switches, and a new persona gets the first-run card', async () => {
  const b = await boot();
  const persona = () => b.document.getElementById('persona');
  await button(persona(), 'NB').click(); await settle();
  await buttons(persona(), 'FB').find((x) => /Fernhollow/.test(x.textContent)).click(); await settle();
  assert.equal(b.ctx.slug, 'fernhollow-bakery');
  assert.match(b.view().textContent, /Fernhollow Bakery@fernhollow-bakery/);
  assert.match(b.view().textContent, /bake to the queue/);
  await button(persona(), 'FB').click(); await settle();
  await button(persona(), 'Add persona').click(); await settle();
  input(persona(), 'New persona name').value = 'Juniper Lane Books';
  await button(persona(), 'Create').click(); await settle();
  assert.equal(b.ctx.slug, 'juniper-lane-books');
  const v = b.view().textContent;
  assert.match(v, /Here's how this works/);
  assert.match(v, /Add your sources/);
  assert.match(v, /Pick your topics/);
  assert.match(v, /Set it to run/);
  await button(b.view(), 'Add sources').click(); await settle();
  assert.match(b.view().textContent, /Add a source/);
  assert.match(b.view().textContent, /Nothing here yet/);
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
  assert.match(html, /window\.STUDIO_SKINS = \["light"\]/);
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

test('Coach: the weekly report, what is waiting with its why, and her tap applies it', async () => {
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
  assert.equal(JSON.parse(b.ctx.store.readFile('sources.json')).feeds.find((f) => f.name === 'Example Transport Policy Notes').paused, true, 'paused by her tap');
});

test('Sources: every kind, records, suggestions she adds or dismisses, and the login and browser states', async () => {
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
  assert.ok(JSON.parse(b.ctx.store.readFile('sources.json')).watch.some((w) => w.handle === '@example_cargo'), 'added on her tap');
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

test('Settings: account slots ask Claude to walk her through signing in and record only that', async () => {
  const b = await boot();
  await b.nav('settings');
  let v = b.view().textContent;
  assert.match(v, /Accounts.*never stores a password and never posts for you/);
  assert.match(v, /X.*Connected/);
  assert.match(v, /Reading signed in: not yet · Posting: not yet/);
  const li = b.view().findAll((e) => e.className === 'row-item').find((r) => /LinkedIn/.test(r.textContent) && /Add account/.test(r.textContent));
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
