import test from 'node:test';
import assert from 'node:assert/strict';
import { testContext, at } from './helpers.js';
import { draftingBrief } from '../server/lib/briefs.js';
import { saveTakes } from '../server/lib/save.js';
import { callTool } from '../server/lib/tools.js';

const NOW = at(2026, 10, 21, 9, 0);
const iso = new Date(NOW).toISOString();
const item = { id: 1, title: 'Bridge lanes open after two years', body: 'The council opened 4 km of protected lanes on the bridge road. Engineer Ana Ruiz led the work.', fetched_at: iso, triaged_at: iso, interest: 8, source: 'rss:n', source_name: 'N', note: 'about time' };

function ctxWith(drafts = [], extra = {}) {
  const t = testContext({ now: NOW });
  t.ctx.tx((db) => { db.items = [item, ...(extra.items || [])]; db.drafts = drafts; });
  return t;
}
const T = (text) => ({ text, thinking: 'hm', topic: 'other' });

test('first submission asks for specific redrafts; the second is final', () => {
  const { ctx } = ctxWith();
  const b = draftingBrief(ctx);
  const first = saveTakes(ctx, { brief_id: b.brief_id, takes: [T('Our mechanic Sam Patel says the climb is easier now.'), T('x'.repeat(400)), T('Four km of lanes, finally on the bridge.')] });
  assert.equal(first.status, 'redraft');
  assert.deepEqual(first.requests.map((r) => r.take), [1, 2]);
  assert.match(first.text, /Sam Patel/);
  assert.match(first.text, /too long/);
  const second = saveTakes(ctx, { brief_id: b.brief_id, takes: [T('Our mechanic Sam Patel still says the climb is easier.'), T('y'.repeat(400)), T('Four km of lanes, finally on the bridge.')] });
  assert.equal(second.status, 'saved');
  assert.equal(second.drafts.length, 2, 'the over-length take is dropped');
  assert.equal(second.dropped[0].take, 2);
  const flags = second.flags.find((f) => f.flags.some((l) => /Sam Patel/.test(l)));
  assert.ok(flags, 'an unresolved name stays as a flag');
  const saved = ctx.store.read('drafts', []);
  assert.ok(saved.every((d) => d.status === 'held'));
  assert.throws(() => saveTakes(ctx, { brief_id: b.brief_id, takes: [] }), /already saved/);
});

test('names in the source are fine; wrong take count is refused', () => {
  const { ctx } = ctxWith();
  const b = draftingBrief(ctx);
  assert.throws(() => saveTakes(ctx, { brief_id: b.brief_id, takes: [T('one')] }), /exactly 3/);
  const r = saveTakes(ctx, { brief_id: b.brief_id, takes: [T('Ana Ruiz and crew made the bridge boring, in the best way.'), T('Climbing the bridge is now the easy bit.'), T('Lanes like these change who rides.')] });
  assert.equal(r.status, 'saved');
});

test('an overused template form gets a redraft on take 1', () => {
  const old = [...Array(6)].map((_, i) => ({ id: 100 + i, status: 'passed', text: `Unpopular opinion: thing ${i}`, created_at: new Date(NOW - 3600e3 * 30).toISOString(), tags: { form: 'hot-take-opener' }, platform: 'x', kind: 'item' }));
  const { ctx } = ctxWith(old);
  const b = draftingBrief(ctx);
  assert.match(b.text, /Overused lately/);
  const r = saveTakes(ctx, { brief_id: b.brief_id, takes: [T('Unpopular opinion: bridges are for bikes.'), T('Climbing the bridge is now the easy bit.'), T('Lanes like these change who rides.')] });
  assert.equal(r.status, 'redraft');
  assert.match(r.text, /hot-take-opener/);
});

test('evergreen posts: cites map to reading memory; uncited stats are flagged', () => {
  const { ctx } = ctxWith();
  ctx.store.writeFile('settings.json', JSON.stringify({ evergreen_per_day: 2, platforms: { linkedin: { enabled: true }, x: { enabled: true } } }));
  const b = draftingBrief(ctx, { evergreen: true });
  assert.equal(b.kind, 'evergreen');
  assert.match(b.text, /Reading memory/);
  let r = saveTakes(ctx, { brief_id: b.brief_id, takes: [{ text: 'Four km of protected lanes is how habits change.', cites: [1] }, { text: 'Most riders quit because of one bad junction, 80% of the time.' }] });
  if (r.status === 'redraft') r = saveTakes(ctx, { brief_id: b.brief_id, takes: [{ text: 'Four km of protected lanes is how habits change.', cites: [1] }, { text: 'Most riders quit because of one bad junction, 80% of the time.' }] });
  assert.equal(r.status, 'saved');
  const ds = ctx.store.read('drafts', []);
  assert.equal(ds.length, 2);
  assert.deepEqual(ds[0].cites, [1]);
  assert.equal(ds[0].kind, 'evergreen');
  assert.ok(ds[1].lint.some((f) => f.code === 'stat-uncited'));
  assert.deepEqual(ds.map((d) => d.platform).sort(), ['linkedin', 'x']);
});

test('the work queue: rewrites first, then stories, then evergreen, then done', () => {
  const { ctx } = ctxWith();
  ctx.store.writeFile('settings.json', JSON.stringify({ evergreen_per_day: 1 }));
  const kinds = [];
  for (let i = 0; i < 5; i++) {
    const b = draftingBrief(ctx);
    if (b.done) break;
    kinds.push(b.kind);
    const n = b.takes;
    const texts = ['Climbing the bridge is now the easy bit.', 'Lanes like these change who rides.', 'Boring infrastructure is the best kind.'];
    let r = saveTakes(ctx, { brief_id: b.brief_id, takes: texts.slice(0, n).map(T) });
    if (r.status === 'redraft') saveTakes(ctx, { brief_id: b.brief_id, takes: texts.slice(0, n).map(T) });
  }
  assert.deepEqual(kinds, ['item', 'evergreen']);
});

test('studio_save_takes reports unknown briefs as a tool error', async () => {
  const { ctx } = ctxWith();
  const r = await callTool(ctx, 'studio_save_takes', { brief_id: 999, takes: [] });
  assert.equal(r.isError, true);
});

test('jobs_only briefs never open new stories', () => {
  const { ctx } = ctxWith();
  assert.equal(draftingBrief(ctx, { jobs_only: true }).done, true);
  assert.equal(draftingBrief(ctx).kind, 'item');
});
