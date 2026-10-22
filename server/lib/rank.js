// Stack rank. score = sum(w_k * s_k) / sum(w_k) x 0.85^lint_flags.
// Signals: hot (freshness + velocity), trending, interest, entertaining. A set ranks by its best take.
import { STOPWORDS, words, percentile, clamp, hoursBetween } from './text.js';

export const DEFAULT_WEIGHTS = { hot: 0.25, trending: 0.20, interest: 0.30, entertaining: 0.25 };
export const LINT_PENALTY = 0.85;
export const SIGNALS = Object.keys(DEFAULT_WEIGHTS);

export function freshness(item, now, halfLife = 6) {
  if (!item) return 0.5;
  const times = [item.published, item.fetched_at].map((t) => Date.parse(t)).filter((t) => Number.isFinite(t) && t <= now);
  if (!times.length) return 0.5;
  const age = Math.max(0, (now - Math.min(...times)) / 3600e3);
  return Math.pow(0.5, age / halfLife);
}

// Velocity needs engagement counts on the source; RSS carries none, so it is neutral.
export function velocity(item, peers = []) {
  const v = item?.stats?.velocity;
  if (v == null) return 0.5;
  const vs = peers.map((p) => p.stats?.velocity).filter((x) => x != null);
  return vs.length >= 5 ? percentile(v, vs) : 0.5;
}

export const hot = (item, now, halfLife, peers) => 0.5 * freshness(item, now, halfLife) + 0.5 * velocity(item, peers);

export function terms(item) {
  const base = item.title || words(item.summary || '').slice(0, 30).join(' ');
  return [...new Set(words(base).filter((w) => (w.length >= 4 || /\d/.test(w)) && !STOPWORDS.has(w)))];
}

const TERM_CACHE = new WeakMap();
function termCache(c) {
  let t = TERM_CACHE.get(c);
  if (!t) { t = new Set(terms(c)); TERM_CACHE.set(c, t); }
  return t;
}

// value = max over terms of (1 - 0.5^others) * clip((burst - 1) / 2, 0, 1),
// burst = (recent_n + 1) / (base_n / 7 + 1), recent = last 24h, base = the 7 days before.
export function trending(item, corpus, now) {
  const day = 24 * 3600e3;
  const recent = [], base = [];
  for (const c of corpus.slice(-6000)) {
    const t = Date.parse(c.fetched_at);
    if (t > now - day && t <= now) recent.push(c);
    else if (t > now - 8 * day && t <= now - day) base.push(c);
  }
  const has = (c, term) => termCache(c).has(term);
  let best = 0;
  for (const term of terms(item)) {
    const r = recent.filter((c) => has(c, term));
    const others = new Set(r.filter((c) => c.source !== item.source).map((c) => c.source)).size;
    const b = base.filter((c) => has(c, term)).length;
    const burst = (r.length + 1) / (b / 7 + 1);
    const v = (1 - Math.pow(0.5, others)) * clamp((burst - 1) / 2, 0, 1);
    if (v > best) best = v;
  }
  return best;
}

export const interest = (item) => (item && Number.isFinite(item.interest) ? clamp(item.interest / 10, 0, 1) : 0.5);

export function features(d, item, platform) {
  const text = d.final_text || d.text || '';
  const wc = words(text).length;
  const lw = platform?.length_words || { short: 12, mid: 30 };
  const f = [
    ...(d.tags?.shape_ids || []).map((s) => `shape:${s}`),
    `topic:${d.tags?.topic || 'other'}`, `form:${d.tags?.form || 'one-liner'}`, `kind:${d.kind || 'item'}`,
    `experiment:${d.tags?.experiment ? 'yes' : 'no'}`, `platform:${d.platform}`,
    `len:${wc <= lw.short ? 'short' : wc <= lw.mid ? 'mid' : 'long'}`,
  ];
  if (item?.source) f.push(`source:${item.source}`);
  if (/\?/.test(text)) f.push('question');
  if (/\d/.test(text)) f.push('number');
  if (/\b(we|our|i|my)\b/i.test(text)) f.push('first-person');
  if (/[\p{Lu}]{4,}/u.test(text)) f.push('caps');
  return f;
}

// Labels for "entertaining" and for tuning: verdicts at weight 0.25, engagement percentile at 1.
export function labelled(drafts, now, days = 21) {
  const since = now - days * 24 * 3600e3;
  const out = [];
  const byPlat = {};
  for (const d of drafts) if (d.status === 'posted' && d.outcome != null) (byPlat[d.platform] ??= []).push(d.outcome);
  for (const d of drafts) {
    const at = Date.parse(d.decided_at || d.released_at || d.created_at);
    if (!(at >= since)) continue;
    if (['passed', 'edited', 'posted'].includes(d.status) || d.resurrected_at) out.push({ d, y: 1, w: 0.25 });
    else if (['killed', 'passed_over'].includes(d.status)) out.push({ d, y: 0, w: 0.25 });
    if (d.status === 'posted' && d.outcome != null && (byPlat[d.platform] || []).length >= 3) out.push({ d, y: percentile(d.outcome, byPlat[d.platform]), w: 1 });
  }
  return out;
}

export function featureWorth(labels, featureOf) {
  let sy = 0, sw = 0;
  const acc = {};
  for (const { d, y, w } of labels) {
    sy += w * y; sw += w;
    for (const f of featureOf(d)) { const a = (acc[f] ??= { sy: 0, sw: 0 }); a.sy += w * y; a.sw += w; }
  }
  const m = sw ? sy / sw : 0.5;
  const worth = {};
  for (const [f, a] of Object.entries(acc)) worth[f] = (a.sy + 4 * m) / (a.sw + 4) - m;
  return worth;
}

export function estimate(fs, worth) {
  const known = fs.filter((f) => f in worth);
  return known.length ? known.reduce((s, f) => s + worth[f], 0) / known.length : 0;
}

export function combine(signals, weights = DEFAULT_WEIGHTS, flags = 0) {
  let num = 0, den = 0;
  for (const k of SIGNALS) { num += (weights[k] ?? 0) * (signals[k] ?? 0.5); den += weights[k] ?? 0; }
  return (den ? num / den : 0) * Math.pow(LINT_PENALTY, flags);
}

// Rank units (a set or a single). ctx: {items Map, corpus, drafts (history), platforms, weights, now, halfLife}
export function rankUnits(units, ctx) {
  const { now, weights = DEFAULT_WEIGHTS, halfLife = 6 } = ctx;
  const worth = featureWorth(labelled(ctx.drafts || [], now), (d) => features(d, ctx.items.get(d.item_id), ctx.platforms[d.platform]));
  const rows = [];
  for (const u of units) {
    for (const d of u.drafts) {
      const item = ctx.items.get(d.item_id);
      rows.push({ u, d, item, est: estimate(features(d, item, ctx.platforms[d.platform]), worth),
        sig: { hot: item ? hot(item, now, halfLife, []) : 0.5, trending: item ? trending(item, ctx.corpus || [], now) : 0, interest: interest(item) } });
    }
  }
  const ests = rows.map((r) => r.est);
  for (const r of rows) {
    r.sig.entertaining = percentile(r.est, ests);
    r.score = combine(r.sig, weights, (r.d.lint || []).length);
  }
  return units.map((u) => {
    const mine = rows.filter((r) => r.u === u).sort((a, b) => b.score - a.score);
    const top = mine[0];
    return { ...u, score: top ? top.score : 0, top: top?.d.id, signals: top?.sig || {}, perDraft: Object.fromEntries(mine.map((r) => [r.d.id, { score: r.score, signals: r.sig }])) };
  }).sort((a, b) => b.score - a.score);
}

const NOVEL_KEYS = (d, item) => [`topic:${d.tags?.topic}`, ...(d.tags?.shape_ids || []).map((s) => `shape:${s}`), `source:${item?.source || 'none'}`, `form:${d.tags?.form}`, `kind:${d.kind}`, `platform:${d.platform}`];

// Share of a unit's features not seen in what went out in the last 7 days.
export function novelty(unit, recentReleased, items) {
  const seen = new Set();
  for (const d of recentReleased) for (const k of NOVEL_KEYS(d, items.get(d.item_id))) seen.add(k);
  const d = unit.drafts.find((x) => x.id === unit.top) || unit.drafts[0];
  const ks = NOVEL_KEYS(d, items.get(d.item_id));
  return ks.filter((k) => !seen.has(k)).length / ks.length;
}

export const ageHours = (t, now) => hoursBetween(t, now);
