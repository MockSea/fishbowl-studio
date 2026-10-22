import test from 'node:test';
import assert from 'node:assert/strict';
import { freshness, trending, combine, featureWorth, estimate, novelty, interest, rankUnits, velocity } from '../server/lib/rank.js';

const H = 3600e3;
const now = Date.parse('2026-10-21T12:00:00Z');
const iso = (t) => new Date(t).toISOString();

test('freshness halves every 6 hours, from the earlier of published and fetched', () => {
  assert.equal(freshness({ published: iso(now), fetched_at: iso(now) }, now), 1);
  assert.equal(freshness({ published: iso(now - 6 * H), fetched_at: iso(now) }, now), 0.5);
  assert.equal(freshness({ published: iso(now - 12 * H), fetched_at: iso(now - 1 * H) }, now), 0.25);
  assert.equal(freshness({ fetched_at: iso(now - 3 * H) }, now, 3), 0.5);
  assert.equal(velocity({}), 0.5, 'RSS has no counts: neutral');
});

test('score = weighted mean of signals x 0.85 per lint flag', () => {
  const s = { hot: 1, trending: 0, interest: 1, entertaining: 0 };
  const w = { hot: 0.25, trending: 0.20, interest: 0.30, entertaining: 0.25 };
  assert.equal(combine(s, w, 0), 0.55);
  assert.ok(Math.abs(combine(s, w, 2) - 0.55 * 0.85 * 0.85) < 1e-12);
  assert.equal(interest({ interest: 7 }), 0.7);
  assert.equal(interest(null), 0.5);
});

test('trending rewards a burst of a term across other sources', () => {
  const mk = (source, title, hAgo) => ({ source, title, fetched_at: iso(now - hAgo * H) });
  const item = mk('rss:a', 'Tariffs hit bicycle imports', 1);
  const none = trending(item, [item], now);
  assert.equal(none, 0);
  const corpus = [item, mk('rss:b', 'Bicycle tariffs announced', 2), mk('rss:c', 'What tariffs mean for riders', 3), mk('rss:d', 'tariffs again', 4)];
  const v = trending(item, corpus, now);
  // "tariffs": 4 recent, 0 base -> burst 5 -> clip 1; others 3 -> 1 - 0.125
  assert.equal(v, 0.875);
  const base = [...corpus, ...[...Array(28)].map((_, i) => mk('rss:z', 'tariffs old news', 30 + i * 5))];
  assert.ok(trending(item, base, now) < v, 'a term that is always around is not a burst');
});

test('feature worth is a shrunk mean; estimate averages known features', () => {
  const ds = [...Array(8)].map((_, i) => ({ id: i, f: i < 4 ? ['shape:a'] : ['shape:b'] }));
  const labels = ds.map((d, i) => ({ d, y: i < 4 ? 1 : 0, w: 1 }));
  const worth = featureWorth(labels, (d) => d.f);
  assert.equal(worth['shape:a'], (4 + 4 * 0.5) / (4 + 4) - 0.5);
  assert.equal(worth['shape:b'], -0.25);
  assert.equal(estimate(['shape:a', 'shape:zzz'], worth), 0.25);
  assert.equal(estimate(['nothing'], worth), 0);
});

test('novelty is the share of features not seen in the last week', () => {
  const items = new Map([[1, { id: 1, source: 'rss:a' }], [2, { id: 2, source: 'rss:b' }]]);
  const seen = [{ item_id: 1, platform: 'x', kind: 'item', tags: { topic: 't', shape_ids: ['s'], form: 'one-liner' } }];
  const same = { drafts: [{ id: 9, item_id: 1, platform: 'x', kind: 'item', tags: { topic: 't', shape_ids: ['s'], form: 'one-liner' } }] };
  const fresh = { drafts: [{ id: 8, item_id: 2, platform: 'linkedin', kind: 'item', tags: { topic: 'u', shape_ids: ['z'], form: 'list' } }] };
  assert.equal(novelty(same, seen, items), 0);
  assert.equal(novelty(fresh, seen, items), 5 / 6);
});

test('a set ranks by its best take', () => {
  const items = new Map([[1, { id: 1, interest: 9, fetched_at: iso(now), source: 'rss:a', title: 'x' }]]);
  const set = { key: 's1', drafts: [{ id: 1, item_id: 1, lint: [{}, {}], platform: 'x', tags: {} }, { id: 2, item_id: 1, lint: [], platform: 'x', tags: {} }] };
  const [u] = rankUnits([set], { now, items, corpus: [], drafts: [], platforms: { x: {} } });
  assert.equal(u.top, 2);
  assert.ok(u.perDraft[1].score < u.perDraft[2].score);
});
