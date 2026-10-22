import test from 'node:test';
import assert from 'node:assert/strict';
import { tune, nudge, stalled, verdictLabels, outcomeOf, interactions } from '../server/lib/tune.js';

const now = Date.parse('2026-10-21T12:00:00Z');
const H = 3600e3;
const iso = (t) => new Date(t).toISOString();
const W = { hot: 0.25, trending: 0.20, interest: 0.30, entertaining: 0.25 };

function released(id, status, sig) {
  return { id, set_id: null, status, decided_at: iso(now - 2 * H), rank: { signals: sig, top: id, released: true } };
}

test('nudge clips to +-0.02 per day, +-0.1 vs a week ago, and [0.05, 0.6]', () => {
  assert.equal(nudge(0.3, 0.5), 0.32);
  assert.equal(nudge(0.3, -0.5), 0.28);
  assert.equal(nudge(0.3, 0.01), 0.31);
  assert.equal(nudge(0.06, -0.02), 0.05);
  assert.equal(nudge(0.59, 0.02), 0.6);
  assert.equal(nudge(0.4, 0.02, 0.3), 0.4, 'no further than 0.1 from a week ago');
});

test('verdicts teach the weights: passes high on interest pull interest up', () => {
  const drafts = [
    ...[1, 2, 3, 4].map((i) => released(i, 'passed', { hot: 0.5, trending: 0.5, interest: 0.9, entertaining: 0.5 })),
    ...[5, 6, 7, 8].map((i) => released(i, 'killed', { hot: 0.5, trending: 0.5, interest: 0.1, entertaining: 0.5 })),
  ];
  const r = tune({ weights: W, drafts, hearts: [], now });
  assert.equal(r.weights.interest, 0.32);
  assert.equal(r.weights.hot, 0.25);
  assert.equal(r.detail.parts[0].kind, 'verdicts');
});

test('fewer than 4 on either side: no move', () => {
  const drafts = [1, 2, 3].map((i) => released(i, 'passed', { interest: 1 }));
  assert.deepEqual(tune({ weights: W, drafts, hearts: [], now }).weights, W);
});

test('scrapped-then-hearted and resurrected count as passes the rank missed', () => {
  const d1 = { id: 1, status: 'scrapped', scrapped_at: iso(now - H), rank: { signals: {}, top: 1 } };
  const d2 = { id: 2, status: 'pending', resurrected_at: iso(now), released_at: iso(now), rank: { signals: {}, top: 2 } };
  const d3 = { id: 3, status: 'unpicked', decided_at: iso(now), rank: { signals: {}, top: 4 } };
  const labels = verdictLabels([d1, d2, d3], [{ target: 'draft', ref: 1 }], now);
  assert.deepEqual(labels.map((l) => l.y), [1, 1]);
});

test('stall: >=6 measured posts in 3 days with mean < 0.5 interactions moves 0.02 heaviest -> lightest', () => {
  const drafts = [...Array(6)].map((_, i) => ({ id: i, status: 'posted', posted_at: iso(now - H), outcome: 0 }));
  assert.equal(stalled(drafts, now), true);
  const r = tune({ weights: W, drafts, hearts: [], now });
  assert.equal(r.detail.stalled, true);
  assert.equal(r.weights.interest, 0.28);
  assert.equal(r.weights.trending, 0.22);
  assert.equal(stalled(drafts.slice(0, 5), now), false);
});

test('outcome uses the newest snapshot at least 20h after posting', () => {
  const d = { posted_at: iso(now), metrics_snapshots: [{ at: iso(now + 2 * H), likes: 1 }, { at: iso(now + 25 * H), likes: 5, reposts: 1 }, { at: iso(now + 30 * H), likes: 9 }] };
  assert.equal(outcomeOf(d), 9);
  assert.equal(outcomeOf({ posted_at: iso(now), metrics_snapshots: [{ at: iso(now + H), likes: 2 }] }), 2);
  assert.equal(interactions({ likes: 1, reposts: 1, quotes: 1, replies: 1 }), 6);
});
