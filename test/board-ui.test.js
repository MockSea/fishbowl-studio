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

const tick = () => new Promise((r) => setTimeout(r, 5));
async function settle(n = 20) { for (let i = 0; i < n; i++) await tick(); }

async function boot() {
  const home = tempHome();
  seed(home);
  const ctx = makeContext({ home });
  const { document } = makeDom();
  const sent = [];
  const listeners = [];
  const parent = {
    postMessage: async (m) => {
      sent.push(m);
      const reply = (result) => listeners.forEach((f) => f({ source: parent, data: { jsonrpc: '2.0', id: m.id, result } }));
      if (m.method === 'ui/initialize') reply({ protocolVersion: '2026-01-26', hostContext: { theme: 'dark', styles: { variables: { '--color-text-primary': '#fff' } } } });
      else if (m.method === 'tools/call') reply(await callTool(ctx, m.params.name, m.params.arguments));
      else if (m.method === 'ui/message' || m.method === 'ui/open-link') reply({});
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
    Promise, Map, Object, Array, Date, Math, Number, String, JSON, Error, console,
  };
  win.window = win;
  vm.createContext(win);
  const ui = (f) => fs.readFileSync(path.join(PLUGIN_ROOT, 'server', 'ui', f), 'utf8');
  for (const f of ['board-bridge.js', 'board-views.js', 'board-pages.js']) vm.runInContext(ui(f), win, { filename: f });
  await settle();
  return { ctx, document, sent, win, view: () => document.getElementById('view') };
}

const buttons = (root, text) => root.findAll((e) => e.tagName === 'BUTTON' && (text.endsWith('…') || text.endsWith('·') ? e.textContent.trim().startsWith(text) : e.textContent.trim() === text || e.textContent.trim().startsWith(text + ' ')));
const button = (root, text) => buttons(root, text)[0];
const lastButton = (root, text) => buttons(root, text).at(-1);

test('the board handshakes, applies the theme and renders the waiting tab', async () => {
  const b = await boot();
  assert.equal(b.sent[0].method, 'ui/initialize');
  assert.equal(b.sent[0].params.protocolVersion, '2026-01-26');
  assert.ok(b.sent.some((m) => m.method === 'ui/notifications/initialized'));
  assert.equal(b.document.documentElement.dataset.theme, 'dark');
  assert.match(b.view().textContent, /Four kilometres of kerb/);
  assert.match(b.view().textContent, /pick one/);
  assert.match(b.view().textContent, /our pick/);
  assert.match(b.document.getElementById('counter').textContent, /of 10 today/);
  assert.match(b.document.getElementById('jobs').textContent, /waiting for Claude/);
  assert.ok(b.sent.some((m) => m.method === 'ui/notifications/size-changed'));
});

test('pick, pass, kill and copy go through studio_act and re-render', async () => {
  const b = await boot();
  await button(b.view(), 'Pick this one').click();
  await settle();
  const drafts = () => b.ctx.store.read('drafts', []);
  assert.equal(drafts().find((d) => d.id === 1).status, 'pending');
  assert.equal(drafts().find((d) => d.id === 2).status, 'unpicked');
  await button(b.view(), 'Pass').click();
  await settle();
  assert.ok(drafts().some((d) => d.status === 'passed' && d.decided_at && Date.now() - Date.parse(d.decided_at) < 60e3));
  await button(b.view(), 'Kill').click();
  await settle();
  assert.ok(b.sent.filter((m) => m.method === 'tools/call' && m.params.name === 'studio_act').length >= 3);
  // Passed tab: copy shows platform and count.
  await button(b.view(), 'Passed').click();
  await settle();
  const copy = button(b.view(), 'Copy ·');
  assert.match(copy.textContent, /Copy · (X|LinkedIn) · \d+\/\d+/);
  await copy.click();
  assert.ok(b.win.copied && b.win.copied.length > 10);
});

test('none of these + redo, restore with reason, resurrect', async () => {
  const b = await boot();
  await button(b.view(), 'None of these…').click();
  await settle();
  await button(b.view(), 'too generic').click();
  await button(b.view(), 'None, redo these').click();
  await settle();
  const jobs = b.ctx.store.read('jobs', []);
  assert.ok(jobs.some((j) => j.kind === 'redo' && j.note === 'too generic'));
  await button(b.view(), 'Killed').click(); await settle();
  await button(b.view(), 'Restore').click(); await settle();
  const ta = b.view().find((e) => e.tagName === 'TEXTAREA');
  ta.value = 'it grew on me';
  await lastButton(b.view(), 'Restore').click(); await settle();
  assert.ok(b.ctx.store.read('reversals', []).some((r) => r.reason === 'it grew on me'));
  await button(b.view(), 'Scrapped').click(); await settle();
  await button(b.view(), 'Resurrect').click(); await settle();
  assert.ok(b.ctx.store.read('drafts', []).some((d) => d.resurrected_at));
});

test('Reads, Playbook and Settings views render and act', async () => {
  const b = await boot();
  const nav = (v) => b.document.querySelectorAll('.navbtn').find((x) => x.dataset.view === v);
  await nav('reads').click(); await settle();
  assert.match(b.view().textContent, /interest 9\/10/);
  assert.match(b.view().textContent, /From wandering/);
  await button(b.view(), 'Draft this').click(); await settle();
  assert.ok(b.ctx.store.read('jobs', []).some((j) => j.kind === 'draft_item'));
  await nav('playbook').click(); await settle();
  assert.match(b.view().textContent, /Proposed changes \(3\)/);
  await button(b.view(), 'Accept').click(); await settle();
  assert.match(b.ctx.store.readFile('playbook.md'), /practical consequence/);
  await nav('settings').click(); await settle();
  assert.match(b.view().textContent, /News feeds \(3\)/);
  const cap = b.view().find((e) => e.tagName === 'INPUT' && e.attrs['aria-label'] === 'Drafts per day');
  cap.value = '8';
  b.view().find((e) => e.tagName === 'SELECT').value = '3'; // the shim has no option selection
  await button(b.view(), 'Save settings').click(); await settle();
  assert.equal(JSON.parse(b.ctx.store.readFile('settings.json')).daily_cap, 8);
  await button(b.view(), 'Ask Claude to change sources').click(); await settle();
  assert.ok(b.sent.some((m) => m.method === 'ui/message'));
});
