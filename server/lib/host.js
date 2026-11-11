// Everything the browser page can ask the app to do, in plain Node so it can be tested without
// a server. web.js maps HTTP requests onto these. The studio runs in this process: tool calls
// go straight to callTool.
import fs from 'node:fs';
import path from 'node:path';
import { makeContext } from './state.js';
import { callTool } from './tools.js';
import { releaseTool } from './run.js';
import { kitFor } from './brandkit.js';
import { makeKeystore, osStore, STORE_LABELS } from './keystore.js';
import { makeClient, makeModel, MODEL } from './engines/api.js';
import { makeEngine, findOnPath, ENGINES } from './engines/index.js';
import { makeCliModel } from './engines/claude-cli.js';
import { makeRunner, makeDailyCap, MAX_CALLS_PER_RUN, MAX_CALLS_PER_DAY, CALLS_PER_BRIEF } from './runner.js';
import { loadSettings } from './config.js';

const DEFAULT_PREFS = { autorun: false, engine: 'auto' };
// The most model calls one tick of the timer may make, across every brand.
export const MAX_CALLS_PER_TICK = MAX_CALLS_PER_RUN;
// After an automatic run fails, that brand is left alone this long.
const RETRY_AFTER_MS = 60 * 60 * 1000;
// Kit files one upload request may carry.
export const MAX_KIT_FILES_PER_ADD = 20;

// home: the studio data folder. appDir: the app's own folder inside it (key marker, preferences,
// the daily call count). Tests pass fakes for the OS key store (os: null means the 0600 file),
// the claude command (claudePath) and both engines.
export function makeHost({
  home, appDir, os = undefined, claudePath = () => findOnPath('claude'),
  createModel = (apiKey) => makeModel({ client: makeClient({ apiKey }) }),
  createCli = (bin) => makeCliModel({ bin }),
  emit = () => {}, now, fetchImpl, dailyCap = MAX_CALLS_PER_DAY,
}) {
  const ctx = makeContext({ home, now, fetchImpl });
  const keys = makeKeystore({ dir: appDir, os: os === undefined ? osStore({ dir: appDir }) : os });
  const prefsFile = path.join(appDir, 'prefs.json');
  let ticking = false;

  const prefs = () => {
    let p = {};
    try { p = JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch { /* defaults */ }
    return { autorun: typeof p.autorun === 'boolean' ? p.autorun : DEFAULT_PREFS.autorun, engine: ENGINES.includes(p.engine) ? p.engine : DEFAULT_PREFS.engine };
  };
  const engine = makeEngine({ keys, mode: () => prefs().engine, claudePath, createApi: createModel, createCli,
    notify: (message) => emit({ kind: 'notice', state: 'notice', message }) });
  const daily = makeDailyCap({ file: path.join(appDir, 'usage.json'), cap: dailyCap, now: () => ctx.now() });
  const runner = makeRunner({ ctx, model: engine, kit: (slug) => kitFor(ctx, slug).content(), progress: emit, daily });
  const active = () => ctx.personas.active();
  const failedAt = new Map();

  // The app's own pages ride on the settings view for the header the shell needs.
  async function appView(view) {
    const base = await callTool(ctx, 'studio_view', { view: 'settings' });
    if (base.isError) return base;
    const { header, stamp } = base.structuredContent;
    const data = view === 'brandkit' ? { kit: kitFor(ctx, active()).list() } : { key: await keyStatus(), model: process.env.STUDIO_MODEL || MODEL };
    return { content: [{ type: 'text', text: view }], structuredContent: { view, header, stamp, ...data } };
  }

  // What the Settings page shows about the engine and the key. Never the key.
  async function keyStatus() {
    const where = keys.where();
    return {
      has: keys.has(), hint: keys.has() ? await keys.hint() : null,
      where, where_label: where ? STORE_LABELS[where] : null,
      target: keys.target(), target_label: STORE_LABELS[keys.target()],
      engine: engine.status(),
      calls_today: daily.used(), calls_per_day: daily.cap,
    };
  }

  // What "Ask Claude" means here. Prompts come from the board's own buttons.
  function route(text) {
    const t = String(text || '');
    const setup = t.match(/^Draft the Fishbowl Studio setup for .* \(persona ([a-z0-9][a-z0-9-]*)\)/);
    if (setup) return { kind: 'wizard', slug: setup[1], go: () => runner.wizard(setup[1]) };
    if (t === 'Run the Fishbowl Studio daily run now.') return { kind: 'daily', slug: active(), go: () => runner.daily(active(), { force: true }) };
    if (/^Run my Fishbowl Studio rewrites and redos now\.$|^Draft the link I just sent to Fishbowl Studio/.test(t)) return { kind: 'jobs', slug: active(), go: () => runner.jobs(active()) };
    return null;
  }

  // One pass of the timer; tick() below keeps two from overlapping.
  async function tickOnce() {
    const budget = runner.budget(MAX_CALLS_PER_TICK);
    for (const p of ctx.personas.list()) {
      const c = ctx.persona(p.slug);
      try { releaseTool(c); } catch { /* a broken persona shouldn't stop the others */ }
      if (!prefs().autorun || !engine.ready() || !c.settings().setup_complete || runner.busy(p.slug)) continue;
      if (ctx.now() - (failedAt.get(p.slug) ?? -Infinity) < RETRY_AFTER_MS) continue;
      if (!budget.can(CALLS_PER_BRIEF)) break;
      const r = await runner.daily(p.slug, { budget });
      if (r.ok) failedAt.delete(p.slug); else failedAt.set(p.slug, ctx.now());
    }
    return { calls: budget.used };
  }

  // On launch: release every batch that came due while the app was closed, one at a time, at
  // most as many as each brand has release times in a day. Returns how many batches released
  // drafts, and how many drafts.
  function catchUp() {
    let batches = 0, drafts = 0;
    for (const p of ctx.personas.list()) {
      const c = ctx.persona(p.slug);
      let hours = 0;
      try { hours = loadSettings(c.store).release_hours.length; } catch { continue; }
      for (let i = 0; i < hours; i++) {
        let r;
        try { r = releaseTool(c); } catch { break; }
        if (!r.ran) break;
        if (r.released.length) { batches++; drafts += r.released.length; }
      }
    }
    return { batches, drafts };
  }

  return {
    ctx, runner, keys, engine, daily,
    async call(name, args = {}) {
      if (name === 'studio_view' && (args.view === 'brandkit' || args.view === 'apikey')) return appView(args.view);
      return callTool(ctx, String(name), args && typeof args === 'object' ? args : {});
    },
    // Starts the run and returns at once; progress arrives through emit().
    ask(text) {
      const r = route(text);
      if (!r) return { ok: false, message: 'The studio does this from its own buttons only: setup drafts, Run it now and the rewrite queue.' };
      if (!engine.ready()) return { ok: false, message: prefs().engine === 'claude' ? 'Claude Code isn\'t installed on this computer. Install it, or choose your API key in Settings.' : 'Add your Anthropic API key in Settings, or install Claude Code, first.' };
      if (runner.busy(r.slug)) return { ok: false, message: 'A run for this brand is already going.' };
      const done = r.go();
      return { ok: true, kind: r.kind, done };
    },
    keyStatus,
    async keySet(k) {
      const r = await keys.set(k);
      if (!r.ok) return r;
      engine.reset();
      return { ok: true, fell_back: r.fellBack, ...(await keyStatus()) };
    },
    async keyClear() { await keys.clear(); engine.reset(); return { ok: true, ...(await keyStatus()) }; },
    kitList: () => kitFor(ctx, active()).list(),
    // files: [{path, name}]: a temporary copy on disk and the name the person's file had.
    async kitAdd(files) {
      const kit = kitFor(ctx, active());
      const results = [];
      for (const f of (Array.isArray(files) ? files : []).slice(0, MAX_KIT_FILES_PER_ADD)) {
        results.push(await kit.add(String(f.path), { now: ctx.now, name: String(f.name || 'file') }));
      }
      return { results, kit: kit.list() };
    },
    kitRemove: (id) => { const kit = kitFor(ctx, active()); return { ...kit.remove(String(id)), kit: kit.list() }; },
    prefsGet: prefs,
    prefsSet(patch) {
      const cur = prefs();
      const next = {
        autorun: patch && typeof patch.autorun === 'boolean' ? patch.autorun : cur.autorun,
        engine: patch && ENGINES.includes(patch.engine) ? patch.engine : cur.engine,
      };
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(prefsFile, JSON.stringify(next, null, 2) + '\n');
      if (next.engine !== cur.engine) engine.reset();
      return next;
    },
    catchUp,
    // Every few minutes while the app is running: release due batches for every brand and, if
    // autorun is on, run the daily run. That run calls the model only when its news setting says
    // it's time to read, or a rewrite is queued. The whole tick shares one call budget, and a
    // brand whose last automatic run failed sits out for an hour.
    async tick() {
      if (ticking) return { calls: 0, skipped: true };
      ticking = true;
      try { return await tickOnce(); } finally { ticking = false; }
    },
  };
}
