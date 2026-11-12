// The web host's own pages and hooks (web-pages.js) on top of the real board scripts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, settle } from './board-boot.js';
import { callTool } from '#core/tools.js';
import { APP_DIR } from '../server/lib/files.js';
import { WEB_SCRIPTS } from '../server/lib/page.js';

const KIT = { accept: ['.pdf', '.md'], limits: { file_bytes: 10485760, image_bytes: 5242880, files: 20 }, files: [], total_bytes: 0 };
const KEY = { has: true, hint: '…WXYZ', where: 'file', where_label: 'a file', target: 'file', target_label: 'a file', missing: null, engine: { mode: 'auto', engine: 'api', claude: { found: false }, claude_failed: null, key: true }, calls_today: 0, calls_per_day: 60 };

// web-bridge.js's members, faked. kitAdd: what the server answers for an upload.
async function bootWeb({ kitAdd = async () => ({ results: [] }), key = KEY, onRun = () => {} } = {}) {
  let ctx;
  const b = await boot({
    extra: WEB_SCRIPTS,
    studio: {
      // The host serves these two views itself (host.js appView); everything else is the real tool.
      callTool: async (name, args) => {
        if (name === 'studio_view' && (args?.view === 'brandkit' || args?.view === 'apikey')) {
          const base = await callTool(ctx, 'studio_view', { view: 'settings' });
          const { header, stamp } = base.structuredContent;
          return { content: [{ type: 'text', text: args.view }], structuredContent: { view: args.view, header, stamp, kit: KIT, key, model: 'claude-test' } };
        }
        return callTool(ctx, name, args || {});
      },
      kit: { add: kitAdd, remove: async () => ({ ok: true }) },
      key: { status: async () => key, set: async () => key, clear: async () => key },
      prefs: { get: async () => ({ autorun: false, engine: 'auto' }), set: async (p) => p },
      onRun,
    },
  });
  ctx = b.ctx;
  await settle();
  return b;
}
const flash = (b) => b.document.getElementById('flash').textContent;
const ui = (f) => fs.readFileSync(path.join(APP_DIR, 'server', 'ui', f), 'utf8');

test('a drop of new and duplicate files says what went in and what didn\'t (B2)', async () => {
  const b = await bootWeb({ kitAdd: async () => ({ results: [
    { ok: true, file: { id: 'a', name: 'tone.md', kind: 'md' } },
    { ok: false, name: 'guidelines.pdf', reason: 'guidelines.pdf is already in the kit. Remove it first to add a newer version.' },
  ] }) });
  await b.nav('brandkit');
  const picker = b.view().find((e) => e.tagName === 'INPUT' && e.attrs.type === 'file');
  picker.files = [{ name: 'tone.md' }, { name: 'guidelines.pdf' }];
  await picker.fire('change'); await settle();
  assert.match(flash(b), /^Added 1 file \(tone\.md\)\. guidelines\.pdf: guidelines\.pdf is already in the kit/);
  assert.match(b.document.getElementById('flash').className, /warn/);
});

test('the first-run card counts three setup steps and says the studio drafts while it is open (B5)', async () => {
  const b = await bootWeb();
  const head = { brand: 'Northwind', first_run: { show: true, steps: [{ key: 'setup', done: false, step: 'questions' }, { key: 'sources', done: false }, { key: 'schedule', done: false }] } };
  const t = b.win.Board.firstRunCard(head).textContent;
  assert.match(t, /Three short steps/);
  assert.match(t, /step 2 of 3/);
  assert.match(t, /while it is open/);
  assert.doesNotMatch(t, /Four short steps|of 4|whether it posts|scheduled task/);
  const resume = b.win.Board.firstRunCard({ brand: 'Northwind', wizard: { step: 'review' } }).textContent;
  assert.match(resume, /step 3 of 3/);
});

test('the Claude page has its own entry in the sidebar, after Settings (B7)', async () => {
  const b = await bootWeb();
  const navs = b.document.querySelectorAll('.navbtn').map((x) => x.dataset.view);
  assert.equal(navs[navs.indexOf('settings') + 1], 'apikey');
  await b.nav('apikey');
  assert.match(b.view().textContent, /Choose how the studio drafts/);
  assert.ok(b.document.querySelector('.navbtn[data-view="apikey"]').textContent.includes('Claude'));
});

test('the page background fills the window on the web host (B8)', async () => {
  const b = await bootWeb();
  const css = b.document.head.children.map((s) => s.textContent).join('\n');
  assert.match(css, /html\[data-host="web"\] \.shell \{ min-height: 100vh; \}/);
  assert.match(ui('web-bridge.js'), /dataset\.host = 'web'/);
  assert.match(ui('board.html'), /class="shell"/);
});

test('long brand names wrap instead of being cut off (B9)', () => {
  const css = ui('board.css');
  const rule = (sel) => css.match(new RegExp(`^${sel.replace(/[.*]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1] || '';
  for (const sel of ['.persona-btn .nm', '.profile .nm', '.menu .item .nm']) {
    assert.doesNotMatch(rule(sel), /nowrap|ellipsis/, sel);
    assert.match(rule(sel), /overflow-wrap: break-word/, sel);
  }
  assert.match(css, /^\.profile \{ flex-wrap: wrap; \}/m);
});

test('the @handle follows the brand\'s name, not the folder it was first made in (B10)', async () => {
  const b = await bootWeb();
  const handle = b.win.BoardHooks.handle;
  assert.equal(handle({ name: 'Café Owl & Co.', slug: 'old-name' }), 'cafe-owl-co');
  assert.equal(handle({ name: '42 Bikes', slug: 'x' }), 'bikes');
  assert.equal(handle({ name: '!!!', slug: 'x' }), null);
  assert.equal(b.win.Board.handle({ name: '!!!', slug: 'kept-slug' }), 'kept-slug');
  const file = path.join(b.home, 'personas.json');
  const reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  reg.personas[0].name = 'Northwind Cycles';
  fs.writeFileSync(file, JSON.stringify(reg));
  await b.win.Board.load({ view: 'drafts' }); await settle();
  const who = b.document.getElementById('persona').textContent;
  assert.match(who, /@northwind-cycles/);
  assert.doesNotMatch(who, /@northwind-bicycles/);
  const post = b.view().find((e) => e.className === 'post-head');
  if (post) assert.match(post.textContent, /@northwind-cycles/);
});

test('a saved key that has gone from its store says so on the Claude page (W2)', async () => {
  const gone = { ...KEY, has: false, hint: null, missing: 'keychain', missing_label: 'the macOS Keychain' };
  const b = await bootWeb({ key: gone });
  await b.nav('apikey');
  assert.match(b.view().textContent, /The saved key isn't in the macOS Keychain any more\. Add it again\./);
  assert.ok(b.view().find((e) => e.tagName === 'BUTTON' && e.textContent === 'Save key'));
});

test('Draft it from a link says when it gets drafted, in the studio\'s words (W5)', async () => {
  const article = '<html><head><title>Ten years of cargo counts</title></head><body><article><p>Cargo bikes now make most of the downtown parcel rounds.</p></article></body></html>';
  const b = await boot({ fetchImpl: async (u) => (u === 'https://read.example.com/cargo' ? { ok: true, status: 200, headers: new Map(), text: async () => article } : { ok: false, status: 404, headers: new Map() }) });
  const btn = (t) => b.view().find((e) => e.tagName === 'BUTTON' && e.textContent.trim() === t);
  const draftIt = async () => {
    b.view().find((e) => e.tagName === 'INPUT' && e.attrs['aria-label'] === 'Article address').value = 'https://read.example.com/cargo';
    await btn('Draft it').click(); await settle();
  };
  await b.nav('sources');
  await draftIt();
  assert.match(flash(b), /^Queued "Ten years of cargo counts"\. It is drafted with the next run, or click Run it now on Schedule\.$/);
  await btn('Ask Claude now').click(); await settle();
  b.ctx.tx((db) => { db.jobs = []; db.links = []; });
  await draftIt();
  const asks = b.sent.filter((m) => m.method === 'ask').map((m) => m.text);
  assert.deepEqual(asks, ['Draft the link I just sent to Fishbowl Studio.']);
  assert.doesNotMatch(flash(b), /do my studio|rewrites/i);
});

test('a run of queued drafts is announced in the studio\'s words (W5)', async () => {
  let listen;
  const b = await bootWeb({ onRun: (f) => { listen = f; } });
  listen({ state: 'start', kind: 'jobs' });
  assert.equal(flash(b), 'Working on your queued drafts…');
  assert.doesNotMatch(flash(b), /rewrite/i);
});
