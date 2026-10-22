import test from 'node:test';
import assert from 'node:assert/strict';
import { batchQuota, dueBatches, nextBatchAt, release, unitsOf } from '../server/lib/daily.js';
import { at } from './helpers.js';

const settings = { release_hours: [8, 12, 16, 20], daily_cap: 10, held_max_hours: 16, explore_budget: 0, explore_budget_stalled: 3 };
const H = 3600e3;

test('batch quota = min(left, ceil(left/(n-k)), ceil(2*cap/n))', () => {
  assert.equal(batchQuota(10, 4, 0, 10), 3);
  assert.equal(batchQuota(7, 4, 1, 10), 3);
  assert.equal(batchQuota(4, 4, 2, 10), 2);
  assert.equal(batchQuota(2, 4, 3, 10), 2);
  assert.equal(batchQuota(10, 4, 3, 10), 5, 'a thin earlier pool rolls on, still capped at 2*cap/n');
  assert.equal(batchQuota(50, 4, 0, 50), 13);
  assert.equal(batchQuota(0, 4, 1, 10), 0);
});

test('due batches and the next batch time', () => {
  assert.deepEqual(dueBatches([8, 12, 16, 20], [], at(2026, 10, 21, 7, 59)), []);
  assert.deepEqual(dueBatches([8, 12, 16, 20], [], at(2026, 10, 21, 12, 30)), [0, 1]);
  assert.deepEqual(dueBatches([8, 12, 16, 20], [0], at(2026, 10, 21, 12, 30)), [1]);
  assert.equal(new Date(nextBatchAt([8, 12, 16, 20], [0], at(2026, 10, 21, 9))).getHours(), 12);
  assert.equal(nextBatchAt([8, 12], [0, 1], at(2026, 10, 21, 13)), null);
});

function pool(now, n, { sets = 0, ageH = 1 } = {}) {
  const items = new Map();
  const drafts = [];
  let id = 0;
  for (let i = 0; i < n; i++) {
    items.set(i + 1, { id: i + 1, interest: 10 - i, fetched_at: new Date(now - ageH * H).toISOString(), source: `rss:s${i}`, title: `story ${i}` });
    const takes = i < sets ? 3 : 1;
    for (let t = 0; t < takes; t++) drafts.push({ id: ++id, set_id: takes > 1 ? 100 + i : null, item_id: i + 1, status: 'held', platform: 'x', created_at: new Date(now - ageH * H).toISOString(), lint: [], tags: { topic: 't', shape_ids: ['s'], form: 'one-liner' }, kind: 'item' });
  }
  return { items, drafts };
}

const ctxFor = (now, items, drafts, extra = {}) => ({ settings: { ...settings, ...extra }, now, items, corpus: [...items.values()], drafts, platforms: { x: {} } });

test('first batch releases the top 3 by rank; sets become pick-one, singles pending', () => {
  const now = at(2026, 10, 21, 8, 5);
  const { items, drafts } = pool(now, 6, { sets: 1 });
  const ledger = {};
  const r = release({ drafts, ledger }, ctxFor(now, items, drafts));
  assert.equal(r.ran, true);
  assert.equal(r.released.length, 3);
  assert.deepEqual(drafts.filter((d) => d.set_id === 100).map((d) => d.status), ['option', 'option', 'option']);
  assert.equal(drafts.find((d) => d.item_id === 2).status, 'pending');
  assert.equal(drafts.find((d) => d.item_id === 2).rank.pos, 2);
  assert.equal(drafts.filter((d) => d.status === 'held').length, 3, 'losers stay held before the last batch');
  const again = release({ drafts, ledger }, ctxFor(now + 60e3, items, drafts));
  assert.equal(again.ran, false, 'idempotent within a batch');
});

test('missed batches run as one; stale held drafts are scrapped', () => {
  const now = at(2026, 10, 21, 12, 30);
  const { items, drafts } = pool(now, 8);
  drafts[7].created_at = new Date(now - 17 * H).toISOString();
  const r = release({ drafts, ledger: {} }, ctxFor(now, items, drafts));
  assert.equal(r.batch, 2);
  assert.equal(r.released.length, 4);
  assert.equal(r.scrapped.stale, 1);
  assert.equal(drafts[7].scrap_reason, 'stale');
});

test('the last batch scraps the rest as over the daily cap', () => {
  const now = at(2026, 10, 21, 20, 10);
  const { items, drafts } = pool(now, 9);
  const ledger = { '2026-10-21': { released: 8, batches: [0, 1, 2], scrapped: {}, explore_used: 0, explore_ids: [] } };
  const r = release({ drafts, ledger }, ctxFor(now, items, drafts));
  assert.equal(r.released.length, 2);
  assert.equal(r.scrapped.over_daily_cap, 7);
  assert.equal(drafts.filter((d) => d.status === 'scrapped').length, 7);
  assert.ok(drafts.every((d) => d.status !== 'held'));
});

test('a spent cap scraps the rest even before the last batch', () => {
  const now = at(2026, 10, 21, 12, 5);
  const { items, drafts } = pool(now, 5);
  const ledger = { '2026-10-21': { released: 9, batches: [0], scrapped: {}, explore_used: 0, explore_ids: [] } };
  const r = release({ drafts, ledger }, ctxFor(now, items, drafts));
  assert.equal(r.released.length, 1);
  assert.equal(r.scrapped.over_daily_cap, 4);
});

test('novelty slot: the last place goes to the most novel held draft, within budget', () => {
  const now = at(2026, 10, 21, 8, 5);
  const { items, drafts } = pool(now, 5);
  // Everything shares features with last week's releases except item 5's draft.
  drafts.push({ id: 99, item_id: 1, status: 'posted', platform: 'x', kind: 'item', released_at: new Date(now - 24 * H).toISOString(), tags: { topic: 't', shape_ids: ['s'], form: 'one-liner' } });
  for (const d of drafts) if (d.item_id !== 1 && d.status === 'held') items.get(d.item_id).source = 'rss:s0';
  Object.assign(drafts.find((d) => d.item_id === 5), { platform: 'linkedin' });
  Object.assign(drafts.find((d) => d.item_id === 5).tags, { topic: 'fresh', shape_ids: ['new'], form: 'list' });
  const ledger = {};
  const r = release({ drafts, ledger }, ctxFor(now, items, drafts, { explore_budget: 1 }));
  assert.equal(r.released.length, 3);
  const five = drafts.find((d) => d.item_id === 5);
  assert.equal(five.status, 'pending');
  assert.equal(five.rank.explore, true);
  assert.equal(ledger['2026-10-21'].explore_used, 1);
});

test('unitsOf groups sets', () => {
  assert.equal(unitsOf([{ id: 1, set_id: 5 }, { id: 2, set_id: 5 }, { id: 3, set_id: null }]).length, 2);
});
