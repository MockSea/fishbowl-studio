// The day's ten: drafts land held; at each release hour the held pool is stack-ranked and
// the day's share is released to review. Missed batches run as one. The last batch of the day
// (or a spent cap) scraps the leftovers. Scrapped is not a kill: it teaches nothing.
import { rankUnits, novelty } from './rank.js';
import { localDate } from './text.js';

// Quota for batch k (0-based) of n: min(left, ceil(left/(n-k)), ceil(2*cap/n)).
export function batchQuota(left, n, k, cap) {
  if (left <= 0 || n <= 0) return 0;
  return Math.max(0, Math.min(left, Math.ceil(left / Math.max(1, n - k)), Math.ceil((2 * cap) / n)));
}

export function dueBatches(hours, done, now) {
  const d = new Date(now);
  const mins = d.getHours() * 60 + d.getMinutes();
  return hours.map((h, k) => ({ h, k })).filter(({ h, k }) => h * 60 <= mins && !done.includes(k)).map(({ k }) => k);
}

export function nextBatchAt(hours, done, now) {
  const d = new Date(now);
  const mins = d.getHours() * 60 + d.getMinutes();
  const k = hours.findIndex((h, i) => h * 60 > mins && !done.includes(i));
  if (k < 0) return null;
  const t = new Date(now); t.setHours(hours[k], 0, 0, 0);
  return t.toISOString();
}

export function unitsOf(drafts) {
  const map = new Map();
  for (const d of drafts) {
    const key = d.set_id ?? `d${d.id}`;
    if (!map.has(key)) map.set(key, { key, set_id: d.set_id ?? null, drafts: [] });
    map.get(key).drafts.push(d);
  }
  return [...map.values()];
}

export const dayLedger = (ledger, now) => (ledger[localDate(now)] ??= { released: 0, batches: [], scrapped: {}, explore_used: 0, explore_ids: [] });

function scrap(unit, reason, now) {
  for (const d of unit.drafts) Object.assign(d, { status: 'scrapped', scrap_reason: reason, scrapped_at: new Date(now).toISOString() });
}

// release(state, ctx) mutates state.drafts and state.ledger. Returns a summary.
// ctx: {settings, items Map, corpus, platforms, weights, now, stalled}
export function release(state, ctx) {
  const { settings, now } = ctx;
  const hours = settings.release_hours;
  const day = dayLedger(state.ledger, now);
  const due = dueBatches(hours, day.batches, now);
  if (!due.length) return { ran: false, next: nextBatchAt(hours, day.batches, now) };
  const k = Math.max(...due);
  day.batches.push(...due);
  const n = hours.length, cap = settings.daily_cap;
  const out = { ran: true, batch: k + 1, of: n, released: [], scrapped: { stale: 0, over_daily_cap: 0 }, explore: null };

  let units = unitsOf(state.drafts.filter((d) => d.status === 'held'));
  for (const u of units) {
    const age = (now - Math.min(...u.drafts.map((d) => Date.parse(d.created_at)))) / 3600e3;
    if (age > settings.held_max_hours) { scrap(u, 'stale', now); out.scrapped.stale++; }
  }
  units = units.filter((u) => u.drafts[0].status === 'held');
  const ranked = rankUnits(units, ctx);
  const left = cap - day.released;
  const quota = batchQuota(left, n, k, cap);
  const chosen = ranked.slice(0, quota);
  const rest = ranked.slice(quota);

  const budget = ctx.stalled ? settings.explore_budget_stalled : settings.explore_budget;
  if (chosen.length >= 2 && rest.length && day.explore_used < budget) {
    const recent = state.drafts.filter((d) => d.released_at && now - Date.parse(d.released_at) < 7 * 24 * 3600e3);
    const pool = [chosen[chosen.length - 1], ...rest].map((u) => ({ u, nv: novelty(u, recent, ctx.items) }));
    pool.sort((a, b) => b.nv - a.nv);
    const pickU = pool[0].u;
    if (pickU !== chosen[chosen.length - 1]) {
      rest.splice(rest.indexOf(pickU), 1, chosen[chosen.length - 1]);
      chosen[chosen.length - 1] = pickU;
      pickU.explore = true;
      day.explore_used++;
      day.explore_ids.push(pickU.key);
      out.explore = pickU.key;
    }
  }

  const iso = new Date(now).toISOString();
  chosen.forEach((u, i) => {
    const multi = u.drafts.length > 1;
    for (const d of u.drafts) {
      d.status = multi ? 'option' : 'pending';
      d.released_at = iso;
      d.slot_day = localDate(now);
      d.rank = { ...u.perDraft[d.id], pos: i + 1, of: chosen.length, top: u.top, set_score: u.score, explore: !!u.explore, batch: k + 1, released: true };
    }
    out.released.push(u.key);
  });
  for (const u of rest) for (const d of u.drafts) d.rank = { ...u.perDraft[d.id], top: u.top, set_score: u.score, batch: k + 1, released: false };
  day.released += chosen.length;

  if (k === n - 1 || day.released >= cap) {
    for (const u of rest) { scrap(u, 'over_daily_cap', now); out.scrapped.over_daily_cap++; }
  }
  out.next = nextBatchAt(hours, day.batches, now);
  return out;
}

export function counterLine(drafts, ledger, settings, now) {
  const day = ledger[localDate(now)] || { released: 0, batches: [] };
  const held = unitsOf(drafts.filter((d) => d.status === 'held')).length;
  const scrapped = unitsOf(drafts.filter((d) => d.status === 'scrapped' && d.scrapped_at && localDate(Date.parse(d.scrapped_at)) === localDate(now))).length;
  const next = nextBatchAt(settings.release_hours, day.batches, now);
  return { released: day.released, cap: settings.daily_cap, held, scrapped, next };
}
