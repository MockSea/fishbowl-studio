// Release runner and status. Releases are pure bookkeeping, so the server runs any due batch
// whenever a tool is called: the board shows the right drafts even if the scheduled run was hours ago.
import { release, counterLine, dayLedger } from './daily.js';
import { tune, stalled } from './tune.js';
import { byId } from './state.js';
import { loadSettings } from './config.js';
import { DEFAULT_WEIGHTS } from './rank.js';

const H = 3600e3;

export function currentWeights(db, settings) {
  return db.weights.current || settings.weights || DEFAULT_WEIGHTS;
}

function maybeTune(db, settings, now) {
  const last = db.weights.tuned_at ? Date.parse(db.weights.tuned_at) : 0;
  if (now - last < 20 * H) return null;
  const hist = db.weights.history || [];
  const weekAgo = hist.filter((h) => now - Date.parse(h.at) >= 7 * 24 * H).pop()?.weights || null;
  const old = currentWeights(db, settings);
  const res = tune({ weights: old, weekAgo, drafts: db.drafts, hearts: db.hearts, now });
  const at = new Date(now).toISOString();
  db.weights.current = res.weights;
  db.weights.tuned_at = at;
  db.weights.history = [...hist.slice(-60), { at, weights: res.weights, from: old, detail: res.detail }];
  return res;
}

export function runRelease(ctx, db) {
  const now = ctx.now();
  const settings = loadSettings(ctx.store);
  const day = dayLedger(db.days, now);
  let tuned = null;
  const due = settings.release_hours.some((h, k) => !day.batches.includes(k) && new Date(now).getHours() >= h);
  if (due) tuned = maybeTune(db, settings, now);
  const res = release({ drafts: db.drafts, ledger: db.days }, {
    settings, now, items: byId(db.items), corpus: db.items.filter((i) => !i.explore), drafts: db.drafts,
    platforms: ctx.platforms(), weights: currentWeights(db, settings), halfLife: settings.freshness_half_life_hours,
    stalled: stalled(db.drafts, now),
  });
  if (res.ran) ctx.store.event('release', { batch: res.batch, released: res.released.length, scrapped: res.scrapped, explore: res.explore, tuned: !!tuned }, now);
  return { ...res, tuned: tuned ? tuned.weights : null };
}

export function releaseTool(ctx) {
  return ctx.tx((db) => {
    const r = runRelease(ctx, db);
    const c = counterLine(db.drafts, db.days, ctx.settings(), ctx.now());
    const text = r.ran
      ? `Batch ${r.batch} of ${r.of}: released ${r.released.length} to review${r.explore ? ' (one novelty pick)' : ''}; scrapped ${r.scrapped.stale} stale and ${r.scrapped.over_daily_cap} over the cap. ${counterText(c)}`
      : `No batch is due yet. ${counterText(c)}`;
    return { ...r, counter: c, text };
  });
}

export function counterText(c) {
  const next = c.next ? new Date(c.next).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'tomorrow';
  return `${c.released} of ${c.cap} today · ${c.held} held · next batch ${next} · ${c.scrapped} scrapped`;
}

export function statusTool(ctx) {
  const settings = ctx.settings();
  return ctx.tx((db) => {
    const r = runRelease(ctx, db);
    const c = counterLine(db.drafts, db.days, settings, ctx.now());
    const waiting = new Set(db.drafts.filter((d) => ['pending', 'option'].includes(d.status)).map((d) => d.set_id ?? `d${d.id}`)).size;
    const jobs = db.jobs.filter((j) => j.status === 'queued');
    const untriaged = db.items.filter((i) => !i.explore && !i.duplicate_of && !i.triaged_at).length;
    const openProps = db.proposals.filter((p) => p.status === 'open').length;
    const lines = [
      settings.setup_complete ? `Studio for ${settings.brand || 'your brand'} · data folder: ${ctx.store.home}` : `Setup isn't finished. Run /studio:setup. Data folder: ${ctx.store.home}`,
      counterText(c),
      `${waiting} waiting for review · ${jobs.length} queued job(s) (${jobs.map((j) => j.kind).join(', ') || 'none'}) · ${untriaged} untriaged item(s) · ${openProps} open proposal(s)`,
      db.runs.last_fetch ? `Last fetch ${db.runs.last_fetch}` : 'Never fetched.',
      r.ran ? `Just released batch ${r.batch}: ${r.released.length} to review.` : '',
    ].filter(Boolean);
    return { setup_complete: !!settings.setup_complete, counter: c, waiting, jobs: jobs.map((j) => ({ id: j.id, kind: j.kind })), untriaged, open_proposals: openProps, home: ctx.store.home, text: lines.join('\n') };
  });
}
