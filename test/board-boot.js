// Boots the real board scripts in a vm against the DOM shim, with a stand-in for the bridge:
// window.Studio calls the real tools in-process, and anything the board hands to Claude is
// recorded in `sent` as { method: 'ask', text }. extra: more scripts from server/ui to run after
// the board's (the web host's pages). studio: more window.Studio members those scripts need.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { makeDom } from './dom-shim.js';
import { tempHome } from '../core/test/helpers.js';
import { seed } from '../dev/seed.mjs';
import { makeContext } from '#core/state.js';
import { callTool } from '#core/tools.js';
import { APP_DIR } from '../server/lib/files.js';
import { BOARD_SCRIPTS } from '../server/lib/page.js';

export const tick = () => new Promise((r) => setTimeout(r, 5));
export async function settle(n = 20) { for (let i = 0; i < n; i++) await tick(); }

export async function boot({ fetchImpl, hooks, extra = [], studio = {} } = {}) {
  const home = tempHome();
  seed(home);
  const ctx = makeContext({ home, fetchImpl });
  const { document } = makeDom();
  const sent = [];
  const win = {
    document, innerWidth: 640, navigator: { clipboard: { writeText: async (t) => { win.copied = t; } } },
    addEventListener: () => {},
    requestAnimationFrame: (f) => setTimeout(f, 0), clearTimeout,
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); if (ms > 100) t.unref(); return t; }, ResizeObserver: class { observe() {} },
    Promise, Map, Set, Object, Array, Date, Math, Number, String, JSON, Error, console, STUDIO_SKINS: ['light'],
  };
  win.window = win;
  win.Studio = {
    connect: async () => ({}),
    callTool: async (name, args) => { sent.push({ method: 'call', name }); return callTool(ctx, name, args || {}); },
    askClaude: async (text) => { sent.push({ method: 'ask', text }); return true; },
    copy: async (t) => { win.copied = t; return true; },
    openLink: async (url) => { sent.push({ method: 'link', url }); return true; },
    reportSize: () => {}, setStamp: () => {}, onResult: () => {}, onContext: () => {},
    isSuperseded: () => false, fullscreen: async () => null, displayMode: async () => null,
    ...studio,
  };
  if (hooks) win.BoardHooks = hooks;
  vm.createContext(win);
  const ui = (f) => fs.readFileSync(path.join(APP_DIR, 'server', 'ui', f), 'utf8');
  for (const f of [...BOARD_SCRIPTS, ...extra]) vm.runInContext(ui(f), win, { filename: f });
  await settle();
  const nav = async (v) => { await document.querySelectorAll('.navbtn').find((x) => x.dataset.view === v).click(); await settle(); };
  return { ctx, home, document, sent, win, nav, view: () => document.getElementById('view') };
}
