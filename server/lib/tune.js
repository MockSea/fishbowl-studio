// Daily rank-weight nudges, learned from their verdicts (and posted results when they enter them).
// new_k = old_k + 0.5 * gap_k, clipped to +-0.02/day, +-0.1 vs a week ago, and [0.05, 0.6].
import { SIGNALS, DEFAULT_WEIGHTS } from './rank.js';
import { clamp, mean } from './text.js';

export const STEP_CAP = 0.02, WEEK_CAP = 0.1, W_MIN = 0.05, W_MAX = 0.6;
const DAY = 24 * 3600e3;

export function interactions(m) {
  return (m.likes || 0) + 2 * (m.reposts || 0) + 2 * (m.quotes || 0) + (m.replies || 0);
}

// Outcome of a posted draft: interactions from the newest snapshot >= 20h after posting,
// else the newest snapshot.
export function outcomeOf(d) {
  const snaps = d.metrics_snapshots || [];
  if (!snaps.length) return null;
  const posted = Date.parse(d.posted_at || d.decided_at || 0);
  const mature = snaps.filter((s) => Date.parse(s.at) - posted >= 20 * 3600e3);
  const pick = (mature.length ? mature : snaps).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).pop();
  return interactions(pick);
}

// Units that were ranked, with a label. Released sets ruled pass (1) vs kill/passed_over (0),
// plus scrapped-then-hearted or resurrected drafts as 1 (a pass the rank missed).
export function verdictLabels(drafts, hearts, now, days = 14) {
  const since = now - days * DAY;
  const heartedIds = new Set(hearts.filter((h) => h.target === 'draft').map((h) => h.ref));
  const units = new Map();
  for (const d of drafts) {
    if (!d.rank?.signals) continue;
    const t = Date.parse(d.decided_at || d.released_at || d.scrapped_at || d.created_at);
    if (!(t >= since)) continue;
    const key = d.set_id ?? `d${d.id}`;
    const u = units.get(key) || { signals: d.rank.signals, y: null };
    if (d.rank.top === d.id) u.signals = d.rank.signals;
    if (['passed', 'edited', 'posted'].includes(d.status) || d.resurrected_at || (d.status === 'scrapped' && heartedIds.has(d.id))) u.y = 1;
    else if (u.y !== 1 && ['killed', 'passed_over'].includes(d.status)) u.y = 0;
    units.set(key, u);
  }
  return [...units.values()].filter((u) => u.y !== null);
}

function gaps(hi, lo) {
  return Object.fromEntries(SIGNALS.map((k) => [k, mean(hi.map((u) => u.signals[k] ?? 0.5)) - mean(lo.map((u) => u.signals[k] ?? 0.5))]));
}

export function stalled(drafts, now) {
  const posted = drafts.filter((d) => d.status === 'posted' && d.outcome != null && now - Date.parse(d.posted_at || d.decided_at) <= 3 * DAY);
  if (posted.length < 6) return false;
  const xs = posted.map((d) => d.outcome);
  return mean(xs) < 0.5 || xs.every((x) => x === xs[0]);
}

// tune({weights, weekAgo, drafts, hearts, now}) -> {weights, detail}
export function tune({ weights = DEFAULT_WEIGHTS, weekAgo = null, drafts = [], hearts = [], now }) {
  const parts = [];
  const v = verdictLabels(drafts, hearts, now);
  const pass = v.filter((u) => u.y === 1), non = v.filter((u) => u.y === 0);
  if (pass.length >= 4 && non.length >= 4) parts.push({ g: gaps(pass, non), w: 0.25 * v.length, kind: 'verdicts', n: v.length });
  const eng = drafts.filter((d) => d.status === 'posted' && d.outcome != null && d.rank?.signals);
  if (eng.length >= 8) {
    const sorted = eng.map((d) => d.outcome).sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const hi = eng.filter((d) => d.outcome > med).map((d) => ({ signals: d.rank.signals }));
    const lo = eng.filter((d) => d.outcome <= med).map((d) => ({ signals: d.rank.signals }));
    if (hi.length >= 4 && lo.length >= 4) parts.push({ g: gaps(hi, lo), w: eng.length, kind: 'engagement', n: eng.length });
  }
  const next = { ...weights };
  if (parts.length) {
    const tw = parts.reduce((s, p) => s + p.w, 0);
    for (const k of SIGNALS) {
      const gap = parts.reduce((s, p) => s + p.w * p.g[k], 0) / tw;
      next[k] = nudge(weights[k], 0.5 * gap, weekAgo?.[k]);
    }
  }
  const isStalled = stalled(drafts, now);
  if (isStalled) {
    const heavy = SIGNALS.reduce((a, b) => (next[a] >= next[b] ? a : b));
    const light = SIGNALS.reduce((a, b) => (next[a] <= next[b] ? a : b));
    if (heavy !== light) {
      const move = Math.min(STEP_CAP, next[heavy] - W_MIN, W_MAX - next[light]);
      next[heavy] = round(next[heavy] - move); next[light] = round(next[light] + move);
    }
  }
  return { weights: next, detail: { parts: parts.map(({ kind, n, g }) => ({ kind, n, gaps: roundAll(g) })), stalled: isStalled } };
}

export function nudge(old, delta, weekAgo) {
  let x = old + clamp(delta, -STEP_CAP, STEP_CAP);
  if (weekAgo != null) x = clamp(x, weekAgo - WEEK_CAP, weekAgo + WEEK_CAP);
  return round(clamp(x, W_MIN, W_MAX));
}

const round = (x) => Math.round(x * 10000) / 10000;
const roundAll = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, round(x)]));
