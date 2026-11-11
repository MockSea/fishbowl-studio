// Everything the desktop window can ask the app to do, without Electron in it, so it can be
// tested in plain Node. main.js wires these to IPC. The studio server runs in this process:
// tool calls go straight to callTool, with no MCP hop.
import fs from 'node:fs';
import path from 'node:path';
import { makeContext } from '../server/lib/state.js';
import { callTool } from '../server/lib/tools.js';
import { releaseTool } from '../server/lib/run.js';
import { kitFor } from './brandkit.js';
import { makeKeystore } from './keystore.js';
import { makeClient, makeModel, MODEL } from './llm.js';
import { makeRunner, MAX_CALLS_PER_RUN, CALLS_PER_BRIEF } from './runner.js';

const DEFAULT_PREFS = { autorun: false };
// The most model calls one tick of the timer may make, across every brand.
export const MAX_CALLS_PER_TICK = MAX_CALLS_PER_RUN;
// After an automatic run fails, that brand is left alone this long.
const RETRY_AFTER_MS = 60 * 60 * 1000;

// home: the studio data folder. appDir: the app's own folder (key and preferences).
// createModel(apiKey) -> {ask}; tests pass a fake.
export function makeHost({ home, appDir, safeStorage, createModel = (apiKey) => makeModel({ client: makeClient({ apiKey }) }), emit = () => {}, now, fetchImpl }) {
  const ctx = makeContext({ home, now, fetchImpl });
  const keys = makeKeystore({ dir: appDir, safeStorage });
  const prefsFile = path.join(appDir, 'prefs.json');
  let model = null;
  let ticking = false;

  const prefs = () => { try { return { ...DEFAULT_PREFS, ...JSON.parse(fs.readFileSync(prefsFile, 'utf8')) }; } catch { return { ...DEFAULT_PREFS }; } };
  const getModel = async () => {
    if (!model) { const k = await keys.get(); if (!k) throw new Error('Add your Anthropic API key under Settings first.'); model = createModel(k); }
    return model;
  };
  const runner = makeRunner({ ctx, model: { ask: async (o) => (await getModel()).ask(o) }, kit: (slug) => kitFor(ctx, slug).content(), progress: emit });
  const active = () => ctx.personas.active();
  const failedAt = new Map();

  // Desktop-only pages ride on the settings view for the header the shell needs.
  async function desktopView(view) {
    const base = await callTool(ctx, 'studio_view', { view: 'settings' });
    if (base.isError) return base;
    const { header, stamp } = base.structuredContent;
    const data = view === 'brandkit' ? { kit: kitFor(ctx, active()).list() } : { key: await keyStatus(), model: MODEL };
    return { content: [{ type: 'text', text: view }], structuredContent: { view, header, stamp, ...data } };
  }

  async function keyStatus() {
    return { has: keys.has(), hint: keys.has() ? await keys.hint() : null, encryption: await keys.available() };
  }

  // What "Ask Claude" means in the desktop app. Prompts come from the board's own buttons.
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
      if (!prefs().autorun || !keys.has() || !c.settings().setup_complete || runner.busy(p.slug)) continue;
      if (ctx.now() - (failedAt.get(p.slug) ?? -Infinity) < RETRY_AFTER_MS) continue;
      if (!budget.can(CALLS_PER_BRIEF)) break;
      const r = await runner.daily(p.slug, { budget });
      if (r.ok) failedAt.delete(p.slug); else failedAt.set(p.slug, ctx.now());
    }
    return { calls: budget.used };
  }

  return {
    ctx, runner, keys,
    async call(name, args = {}) {
      if (name === 'studio_view' && (args.view === 'brandkit' || args.view === 'apikey')) return desktopView(args.view);
      return callTool(ctx, String(name), args && typeof args === 'object' ? args : {});
    },
    // Starts the run and returns at once; progress arrives through emit().
    ask(text) {
      const r = route(text);
      if (!r) return { ok: false, message: 'The desktop app does this from its own buttons only: setup drafts, Run it now and the rewrite queue. Use Claude with the plugin for the rest.' };
      if (!keys.has()) return { ok: false, message: 'Add your Anthropic API key under Settings first.' };
      if (runner.busy(r.slug)) return { ok: false, message: 'A run for this brand is already going.' };
      const done = r.go();
      return { ok: true, kind: r.kind, done };
    },
    keyStatus,
    async keySet(k) { const r = await keys.set(k); if (r.ok) model = null; return r.ok ? { ok: true, ...(await keyStatus()) } : r; },
    async keyClear() { keys.clear(); model = null; return { ok: true, ...(await keyStatus()) }; },
    kitList: () => kitFor(ctx, active()).list(),
    async kitAdd(paths) {
      const kit = kitFor(ctx, active());
      const results = [];
      for (const p of (Array.isArray(paths) ? paths : []).slice(0, 20)) results.push(await kit.add(String(p), { now: ctx.now }));
      return { results, kit: kit.list() };
    },
    kitRemove: (id) => { const kit = kitFor(ctx, active()); return { ...kit.remove(String(id)), kit: kit.list() }; },
    prefsGet: prefs,
    prefsSet(patch) {
      const next = { ...prefs(), ...(patch && typeof patch.autorun === 'boolean' ? { autorun: patch.autorun } : {}) };
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(prefsFile, JSON.stringify(next, null, 2) + '\n');
      return next;
    },
    // Every few minutes while the app is running: release due batches for every brand and, if
    // autorun is on, run the daily run. That run calls the model only when its news setting says
    // it's time to read, or a rewrite is queued. The whole tick shares one call budget, and a
    // brand whose last automatic run failed sits out for an hour.
    async tick() {
      // A tick still running (a slow feed or API call) makes the next one a no-op, so two ticks
      // never run side by side with a budget each.
      if (ticking) return { calls: 0, skipped: true };
      ticking = true;
      try { return await tickOnce(); } finally { ticking = false; }
    },
  };
}
