// Shape weighting and picking. A shape is a structural mechanism (data in shapes/*.json).
// w = (1 + passes + edits + posted + hearts) / (1 + kills) x results multiplier x HOME weight.
// With probability explore_share (0.25) the pick is uniform instead.
import { weightedPick } from './rng.js';
import { clamp, mean } from './text.js';

const PASSED = new Set(['passed', 'edited', 'posted']);

export function engagementScore(m) {
  if (!m) return null;
  const inter = (m.likes || 0) + 2 * (m.reposts || 0) + 2 * (m.quotes || 0) + (m.replies || 0);
  return m.views > 0 ? inter / m.views : inter;
}

export function shapeVotes(drafts, hearts = []) {
  const votes = {};
  const v = (id) => (votes[id] ??= { up: 0, down: 0 });
  const byId = new Map(drafts.map((d) => [d.id, d]));
  for (const d of drafts) {
    const ids = d.tags?.shape_ids || [];
    const up = PASSED.has(d.status) || d.resurrected_at;
    for (const id of ids) {
      if (up) v(id).up++;
      else if (d.status === 'killed') v(id).down++;
    }
  }
  for (const h of hearts) {
    if (h.target !== 'draft') continue;
    const d = byId.get(h.ref);
    for (const id of d?.tags?.shape_ids || []) v(id).up++;
  }
  return votes;
}

// Per-shape multiplier from posted metrics: mean(score / platform mean) for the shape,
// over the same ratio for all measured posts, clamped to [0.25, 4].
export function resultsMultipliers(drafts) {
  const measured = drafts.filter((d) => d.status === 'posted' && d.metrics && engagementScore(d.metrics) != null);
  if (!measured.length) return {};
  const byPlat = {};
  for (const d of measured) (byPlat[d.platform] ??= []).push(engagementScore(d.metrics));
  const platMean = Object.fromEntries(Object.entries(byPlat).map(([p, xs]) => [p, mean(xs)]));
  const ratio = (d) => (platMean[d.platform] > 0 ? engagementScore(d.metrics) / platMean[d.platform] : 1);
  const overall = mean(measured.map(ratio));
  const perShape = {};
  for (const d of measured) for (const id of d.tags?.shape_ids || []) (perShape[id] ??= []).push(ratio(d));
  const out = {};
  for (const [id, rs] of Object.entries(perShape)) out[id] = overall > 0 ? clamp(mean(rs) / overall, 0.25, 4) : 1;
  return out;
}

export function shapeWeight(shape, votes, mult, homeWeight = 2) {
  const v = votes[shape.id] || { up: 0, down: 0 };
  return ((1 + v.up) / (1 + v.down)) * (mult[shape.id] ?? 1) * (shape.home ? homeWeight : 1);
}

export function eligible(shapes, platformId) {
  return shapes.filter((s) => !s.platforms || s.platforms.includes(platformId));
}

// Pick `n` shapes (one per take), distinct, avoiding shapes tied to overused forms.
// experiment: take 1 becomes a hybrid "A x B" (B is never HOME).
export function pickShapes({ shapes, platform, n = 3, rng, votes = {}, mult = {}, avoidForms = new Set(), exploreShare = 0.25, homeWeight = 2, experiment = false, used = new Set() }) {
  const base = eligible(shapes, platform);
  let pool = base.filter((s) => !(s.form && avoidForms.has(s.form)) && !used.has(s.id));
  if (!pool.length) pool = base.filter((s) => !used.has(s.id));
  if (!pool.length) pool = base;
  const picks = [];
  const taken = new Set();
  for (let i = 0; i < n; i++) {
    const avail = pool.filter((s) => !taken.has(s.id));
    const spare = base.filter((s) => !taken.has(s.id));
    const from = avail.length ? avail : spare.length ? spare : pool;
    const explore = rng.chance(exploreShare);
    const s = explore ? rng.pick(from) : weightedPick(rng, from, (x) => shapeWeight(x, votes, mult, homeWeight));
    taken.add(s.id);
    const pick = { ids: [s.id], shapes: [s], hybrid: false, explore };
    if (experiment && i === 0) {
      const partners = from.filter((x) => x.id !== s.id && !x.home);
      if (partners.length) {
        const b = rng.pick(partners);
        taken.add(b.id);
        Object.assign(pick, { ids: [s.id, b.id], shapes: [s, b], hybrid: true });
      }
    }
    picks.push(pick);
  }
  return picks;
}
