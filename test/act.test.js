import test from 'node:test';
import assert from 'node:assert/strict';
import { testContext, at } from './helpers.js';
import { act, fingerprint } from '../server/lib/act.js';
import { draftingBrief } from '../server/lib/briefs.js';
import { saveTakes } from '../server/lib/save.js';

const NOW = at(2026, 10, 21, 9, 0);

function seeded(drafts, items = [{ id: 1, title: 'Bridge lanes open', body: 'The council opened lanes on the bridge.', fetched_at: new Date(NOW).toISOString(), triaged_at: new Date(NOW).toISOString(), interest: 8, source: 'rss:n', source_name: 'N' }]) {
  const t = testContext({ now: NOW });
  t.ctx.tx((db) => { db.items = items; db.drafts = drafts.map((d) => ({ platform: 'x', kind: 'item', item_id: 1, created_at: new Date(NOW).toISOString(), lint: [], tags: { shape_ids: ['plain-take'], topic: 'other' }, thinking: 'a thought', ...d })); });
  t.ctx.store.write('meta', { ids: { draft: 100, set: 100 } });
  return t;
}
const get = (ctx, id) => ctx.store.read('drafts', []).find((d) => d.id === id);

test('pass and edit need the current fingerprint; kill does not', () => {
  const { ctx } = seeded([{ id: 1, status: 'pending', text: 'Original line' }]);
  assert.equal(act(ctx, { action: 'pass', id: 1 }).ok, false, 'missing hash refused');
  const fp = fingerprint({ text: 'Original line' });
  const e = act(ctx, { action: 'edit', id: 1, hash: fp, text: 'My better line' });
  assert.equal(e.ok, true);
  assert.equal(act(ctx, { action: 'pass', id: 1, hash: fp }).ok, false, 'old fingerprint after an edit is refused');
  assert.equal(act(ctx, { action: 'pass', id: 1, hash: e.hash }).ok, true);
  assert.equal(get(ctx, 1).status, 'edited');
  assert.equal(act(ctx, { action: 'kill', id: 1 }).ok, true);
});

test('edits are bounded by the platform limit and cannot be only a link', () => {
  const { ctx } = seeded([{ id: 1, status: 'pending', text: 'x' }]);
  const h = fingerprint({ text: 'x' });
  assert.match(act(ctx, { action: 'edit', id: 1, hash: h, text: 'y'.repeat(281) }).message, /Too long/);
  assert.match(act(ctx, { action: 'edit', id: 1, hash: h, text: 'https://example.com/a' }).message, /only a link/);
});

test('picking one take unpicks the rest; none-of-these passes over the set', () => {
  const { ctx } = seeded([1, 2, 3].map((n) => ({ id: n, set_id: 7, take_n: n, status: 'option', text: `take ${n}` })).concat([4, 5].map((n) => ({ id: n, set_id: 8, take_n: n - 3, status: 'option', text: `t${n}` }))));
  act(ctx, { action: 'pick', id: 2 });
  assert.deepEqual([1, 2, 3].map((i) => get(ctx, i).status), ['unpicked', 'pending', 'unpicked']);
  act(ctx, { action: 'none', set_id: 8, note: 'too generic' });
  assert.deepEqual([4, 5].map((i) => get(ctx, i).status), ['passed_over', 'passed_over']);
  assert.equal(act(ctx, { action: 'kill', id: 4 }).ok, false);
});

test('the rewrite queue holds at most 3; posted drafts are never rewritten', () => {
  const { ctx } = seeded([1, 2, 3, 4, 5].map((id) => ({ id, status: id === 5 ? 'posted' : 'pending', text: `line ${id}` })));
  for (const id of [1, 2, 3]) assert.equal(act(ctx, { action: 'note', id, text: 'sharper' }).needs_claude, true);
  const fourth = act(ctx, { action: 'note', id: 4, text: 'sharper' });
  assert.match(fourth.message, /already waiting/);
  assert.match(act(ctx, { action: 'note', id: 5, text: 'x' }).message, /never rewritten/);
  assert.equal(ctx.store.read('jobs', []).filter((j) => j.kind === 'rewrite').length, 3);
  assert.equal(ctx.store.read('feedback', []).length, 5, 'every note is kept');
});

test('redo: at most 2 per story, and the new set inherits the old slot', () => {
  const { ctx } = seeded([1, 2, 3].map((n) => ({ id: n, set_id: 7, take_n: n, status: 'option', text: `take ${n}`, slot_day: '2026-10-21', released_at: new Date(NOW).toISOString() })));
  const r = act(ctx, { action: 'redo', set_id: 7, note: 'all too earnest' });
  assert.equal(r.ok, true);
  assert.deepEqual([1, 2, 3].map((i) => get(ctx, i).status), ['passed_over', 'passed_over', 'passed_over']);
  const b = draftingBrief(ctx);
  assert.equal(b.kind, 'redo');
  assert.match(b.text, /all too earnest/);
  assert.match(b.text, /take 1/);
  const s = saveTakes(ctx, { brief_id: b.brief_id, takes: ['Fresh angle one here.', 'A second fresh angle.', 'Third, different again.'].map((text) => ({ text, topic: 'other' })) });
  if (s.status === 'redraft') saveTakes(ctx, { brief_id: b.brief_id, takes: ['Fresh angle one here!', 'Second, freshly angled.', 'Third and different again.'].map((text) => ({ text, topic: 'other' })) });
  const fresh = ctx.store.read('drafts', []).filter((d) => d.redo_of === 7);
  assert.equal(fresh.length, 3);
  assert.ok(fresh.every((d) => d.status === 'option' && d.slot_day === '2026-10-21'));
  const newSet = fresh[0].set_id;
  assert.equal(act(ctx, { action: 'redo', set_id: newSet }).ok, true, 'second redo allowed');
  ctx.tx((db) => { db.drafts.push({ id: 50, set_id: 99, item_id: 1, status: 'passed_over', text: 'z', platform: 'x' }); });
  const third = act(ctx, { action: 'redo', set_id: 99 });
  assert.equal(third.ok, false);
  assert.match(third.message, /limit is 2/);
});

test('restore needs a reason and reaches the drafter; resurrect brings a take back alone', () => {
  const { ctx } = seeded([{ id: 1, status: 'killed', text: 'killed line' }, { id: 2, set_id: 9, take_n: 1, status: 'scrapped', text: 'scrapped take' }, { id: 3, set_id: 9, take_n: 2, status: 'scrapped', text: 'other' }]);
  assert.match(act(ctx, { action: 'restore', id: 1 }).message, /needs a reason/);
  assert.equal(act(ctx, { action: 'restore', id: 1, reason: 'it grew on me' }).ok, true);
  assert.equal(get(ctx, 1).status, 'pending');
  assert.equal(get(ctx, 1).restore_trail[0].reason, 'it grew on me');
  act(ctx, { action: 'resurrect', id: 2 });
  assert.equal(get(ctx, 2).status, 'pending');
  assert.equal(get(ctx, 2).set_id, null);
  assert.equal(get(ctx, 3).status, 'scrapped');
  act(ctx, { action: 'note', id: 2, text: 'x' });
  const b = draftingBrief(ctx);
  assert.match(b.text, /it grew on me/);
});

test('hearts toggle; draft-this queues work for Claude; mark posted wants https', () => {
  const { ctx } = seeded([{ id: 1, status: 'passed', text: 'hearted line' }]);
  assert.equal(act(ctx, { action: 'heart', id: 1 }).hearted, true);
  assert.equal(act(ctx, { action: 'heart', id: 1 }).hearted, false);
  assert.equal(act(ctx, { action: 'heart', target: 'thinking', id: 1 }).hearted, true);
  assert.equal(act(ctx, { action: 'draft_this', id: 1 }).needs_claude, true);
  assert.equal(act(ctx, { action: 'draft_this', id: 1 }).ok, false, 'no duplicate job');
  assert.equal(act(ctx, { action: 'draft_this', item_id: 1 }).ok, true);
  assert.equal(act(ctx, { action: 'mark_posted', id: 1, url: 'http://insecure.example.com' }).ok, false);
  assert.equal(act(ctx, { action: 'mark_posted', id: 1, url: 'https://social.example.com/p/9' }).ok, true);
  const b = draftingBrief(ctx);
  assert.equal(b.kind, 'draft_item');
});
