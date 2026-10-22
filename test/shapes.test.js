import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeVotes, shapeWeight, pickShapes, resultsMultipliers, engagementScore } from '../server/lib/shapes.js';
import { makeRng, weightedPick } from '../server/lib/rng.js';
import { seedShapes } from '../server/lib/config.js';

const shapes = [
  { id: 'home', name: 'home', home: true, platforms: ['x', 'linkedin'] },
  { id: 'a', name: 'a', platforms: ['x', 'linkedin'], form: 'list' },
  { id: 'b', name: 'b', platforms: ['x', 'linkedin'] },
  { id: 'c', name: 'c', platforms: ['linkedin'] },
];

test('13 seed shapes, one HOME, every one tagged with platforms', () => {
  const s = seedShapes();
  assert.equal(s.length, 13);
  assert.equal(s.filter((x) => x.home).length, 1);
  assert.ok(s.every((x) => x.platforms?.length && x.mechanism));
});

test('weight = (1 + passes + hearts) / (1 + kills) x multiplier x home', () => {
  const drafts = [
    { id: 1, status: 'passed', tags: { shape_ids: ['a'] } }, { id: 2, status: 'edited', tags: { shape_ids: ['a'] } },
    { id: 3, status: 'killed', tags: { shape_ids: ['a'] } }, { id: 4, status: 'scrapped', resurrected_at: 'x', tags: { shape_ids: ['b'] } },
    { id: 5, status: 'passed_over', tags: { shape_ids: ['b'] } },
  ];
  const votes = shapeVotes(drafts, [{ target: 'draft', ref: 3 }]);
  assert.deepEqual(votes.a, { up: 3, down: 1 });
  assert.deepEqual(votes.b, { up: 1, down: 0 }, 'passed_over is not a kill');
  assert.equal(shapeWeight(shapes[1], votes, {}), 2);
  assert.equal(shapeWeight(shapes[1], votes, { a: 0.5 }), 1);
  assert.equal(shapeWeight(shapes[0], votes, {}, 2), 2);
});

test('results multiplier is clamped to [0.25, 4]', () => {
  const mk = (id, shape, likes) => ({ id, status: 'posted', platform: 'x', tags: { shape_ids: [shape] }, metrics: { views: 100, likes } });
  const m = resultsMultipliers([mk(1, 'a', 100), mk(2, 'b', 1), mk(3, 'b', 1), mk(4, 'b', 1), mk(5, 'b', 1), mk(6, 'b', 1), mk(7, 'b', 1), mk(8, 'b', 1), mk(9, 'b', 1), mk(10, 'b', 1), mk(11, 'b', 1), mk(12, 'b', 1)]);
  assert.equal(m.a, 4);
  assert.ok(m.b < 1 && m.b >= 0.25);
  assert.equal(engagementScore({ views: 10, likes: 1, reposts: 1, quotes: 0, replies: 1 }), 0.4);
  assert.equal(engagementScore({ likes: 3 }), 3);
});

test('the 25% explore pick is uniform; the rest is weighted', () => {
  const rng = makeRng(7);
  const votes = { b: { up: 40, down: 0 } };
  let explore = 0, b = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const [p] = pickShapes({ shapes, platform: 'x', n: 1, rng, votes, exploreShare: 0.25 });
    if (p.explore) explore++;
    if (p.ids[0] === 'b') b++;
  }
  assert.ok(Math.abs(explore / N - 0.25) < 0.03, `explore share ${explore / N}`);
  assert.ok(b / N > 0.7, 'heavily passed shape dominates the weighted picks');
});

test('picks are distinct per take, platform-eligible, and avoid overused forms', () => {
  const rng = makeRng(1);
  for (let i = 0; i < 200; i++) {
    const p = pickShapes({ shapes, platform: 'x', n: 3, rng, avoidForms: new Set(['list']) });
    const ids = p.map((x) => x.ids[0]);
    assert.equal(new Set(ids).size, 3);
    assert.ok(!ids.includes('c'), 'c is linkedin-only');
    assert.equal(ids[2], 'a', 'the overused-form shape is only used once the others run out');
  }
});

test('experiments make take 1 a hybrid whose partner is never HOME', () => {
  const rng = makeRng(3);
  for (let i = 0; i < 100; i++) {
    const [p] = pickShapes({ shapes, platform: 'linkedin', n: 1, rng, experiment: true });
    assert.equal(p.hybrid, true);
    assert.ok(!p.shapes[1].home);
  }
});

test('seeded rng is reproducible; weightedPick respects weights', () => {
  const a = makeRng(5), b = makeRng(5);
  assert.deepEqual([a.next(), a.next()], [b.next(), b.next()]);
  const r = makeRng(9);
  let hits = 0;
  for (let i = 0; i < 1000; i++) if (weightedPick(r, [{ w: 9 }, { w: 1 }]).w === 9) hits++;
  assert.ok(hits > 850 && hits < 950);
});
