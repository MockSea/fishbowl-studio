// Opt-in posting: off by default, on only from the board after the warning; approving on the
// board schedules the exact text; the post goes out only if it still matches; missed and failed
// posts surface with their reason and are never retried by themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { testContext, at } from './helpers.js';
import { callTool, TOOLS } from '../server/lib/tools.js';
import { setAccount, accountsView, validateAccountType } from '../server/lib/accounts.js';
import { nextSlot, textHash, GRACE_MIN } from '../server/lib/posting.js';
import { fingerprint } from '../server/lib/act.js';

const NOW = at(2026, 10, 22, 9, 30); // a Thursday; release hours 8, 12, 16, 20
const MIN = 60e3;

const call = async (ctx, name, args) => {
  const r = await callTool(ctx, name, args);
  let body = null;
  try { body = JSON.parse(r.content[0].text); } catch {}
  return { ...r, sc: r.structuredContent || body || {}, text: r.content[0].text };
};

function setup() {
  const t = testContext({ now: NOW });
  t.ctx.store.writeFile('settings.json', JSON.stringify({ brand: 'Northwind Bicycles', setup_complete: true, posts_per_day: 2 }));
  t.ctx.tx((db) => {
    db.drafts = [
      { id: 1, status: 'pending', platform: 'x', text: 'Four kilometres of kerb. That is what a lane looks like.', created_at: new Date(NOW).toISOString(), tags: { topic: 'infrastructure' } },
      { id: 2, status: 'pending', platform: 'x', text: 'Most squeaks are a clean and a drop of oil.', created_at: new Date(NOW).toISOString(), tags: { topic: 'repair' } },
      { id: 3, status: 'pending', platform: 'linkedin', text: 'Repair before replace, every time it is safe.', created_at: new Date(NOW).toISOString(), tags: { topic: 'repair' } },
    ];
  });
  return t;
}
// The queue is instructions, then the posts as JSON; check and result answer in JSON.
const parse = (t) => (t.startsWith('{') ? JSON.parse(t) : t.includes('\n{') ? { done: false, ...JSON.parse(t.slice(t.indexOf('\n{') + 1)) } : { done: true, posts: [], text: t });
const draft = (ctx, id) => ctx.store.read('drafts', []).find((d) => d.id === id);
const posts = (ctx) => ctx.store.read('posts', []);
const hashOf = (ctx, id) => fingerprint(draft(ctx, id));

test('"Post for me" is off by default, and turning it on needs her second tap after the warning', async () => {
  const { ctx } = setup();
  setAccount(ctx, { action: 'connect', type: 'x' });
  const x = () => ctx.tx((db) => accountsView(ctx, db)).find((a) => a.id === 'x');
  assert.equal(x().posting.on, false, 'connected, still off');
  // Approving on the board while it's off just approves.
  const r = await call(ctx, 'studio_post_schedule', { id: 1, hash: hashOf(ctx, 1) });
  assert.equal(draft(ctx, 1).status, 'passed');
  assert.match(r.text, /"Post for me" is off/);
  assert.equal(posts(ctx).length, 0);
  // The switch alone shows the warning; only confirmed turns it on.
  const first = await call(ctx, 'studio_account_posting', { type: 'x', on: true });
  assert.equal(first.sc.ok, false);
  assert.equal(first.sc.needs_confirm, true);
  assert.match(first.sc.warning, /breaks X's rules.*restrict/);
  assert.equal(x().posting.on, false);
  await call(ctx, 'studio_account_posting', { type: 'x', on: true, confirmed: true });
  assert.equal(x().posting.on, true);
  await call(ctx, 'studio_account_posting', { type: 'x', on: false });
  const row = ctx.store.read('accounts', [])[0];
  assert.deepEqual(Object.keys(row.posting).sort(), ['history', 'on'], 'when it was turned on and off; nothing else');
  assert.deepEqual(row.posting.history.map((h) => Object.keys(h).sort().join()), ['at,on', 'at,on']);
  assert.deepEqual(row.posting.history.map((h) => h.on), [true, false]);
  assert.ok(!JSON.stringify(row).match(/token|cookie|password|secret/i), 'no credentials');
  // Only a connected account that can post.
  assert.match((await call(ctx, 'studio_account_posting', { type: 'linkedin', on: true, confirmed: true })).text, /Connect LinkedIn first/);
  setAccount(ctx, { action: 'connect', type: 'reddit' });
  assert.match((await call(ctx, 'studio_account_posting', { type: 'reddit', on: true, confirmed: true })).text, /can't post to Reddit/);
});

test('the model has no tool path that turns posting on or approves a draft for posting', async () => {
  const { ctx } = setup();
  setAccount(ctx, { action: 'connect', type: 'x' });
  const vis = (t) => t._meta?.ui?.visibility || ['model'];
  assert.deepEqual(vis(TOOLS.find((t) => t.name === 'studio_account_posting')), ['app']);
  assert.deepEqual(vis(TOOLS.find((t) => t.name === 'studio_post_schedule')), ['app']);
  // Every tool the model can see, called with everything that might flip it.
  const bag = { action: 'on', type: 'x', on: true, confirmed: true, id: 1, hash: hashOf(ctx, 1), file: 'settings.json', patch: { posting: true }, content: { posting: true } };
  for (const t of TOOLS.filter((x) => vis(x).includes('model'))) {
    await callTool(ctx, t.name, { ...bag });
    for (const action of ['queue', 'set', 'patch', 'pass', 'edit', 'connect', 'accept']) await callTool(ctx, t.name, { ...bag, action });
  }
  assert.equal(ctx.store.read('accounts', []).find((a) => a.type === 'x').posting, undefined, 'still off');
  assert.equal(posts(ctx).length, 0, 'nothing scheduled');
  // With posting on (her tap), approving in chat still schedules nothing, and says so.
  await call(ctx, 'studio_account_posting', { type: 'x', on: true, confirmed: true });
  const pass = await call(ctx, 'studio_act', { action: 'pass', id: 2, hash: hashOf(ctx, 2) });
  assert.match(pass.text, /won't be posted for you: only Approve on the board/);
  assert.equal(posts(ctx).length, 0);
  assert.equal(parse((await call(ctx, 'studio_posting', { action: 'queue' })).text).done, true);
  // studio_config can't reach the accounts file.
  assert.equal((await call(ctx, 'studio_config', { action: 'set', file: 'state/accounts.json', content: [] })).isError, true);
});

test('approving on the board schedules the exact text for the next release hour; a changed text is never posted', async () => {
  const { ctx, clock } = setup();
  setAccount(ctx, { action: 'connect', type: 'x' });
  await call(ctx, 'studio_account_posting', { type: 'x', on: true, confirmed: true });
  const r = await call(ctx, 'studio_post_schedule', { id: 1, hash: hashOf(ctx, 1) });
  assert.match(r.text, /Claude posts it to X at 12:00 today, if your computer is awake/);
  const p = posts(ctx)[0];
  assert.equal(p.approved_hash, textHash('Four kilometres of kerb. That is what a lane looks like.'));
  assert.equal(new Date(p.slot).getHours(), 12);
  // Save & approve: her edited text is what is hashed. One post per slot, so this one goes at 16:00.
  await call(ctx, 'studio_post_schedule', { id: 2, hash: hashOf(ctx, 2), text: 'Most squeaks are a clean and a drop of oil. Most.' });
  assert.equal(posts(ctx)[1].approved_hash, textHash('Most squeaks are a clean and a drop of oil. Most.'));
  assert.equal(new Date(posts(ctx)[1].slot).getHours(), 16);
  // Nothing is due before 12:00.
  assert.equal(parse((await call(ctx, 'studio_posting', { action: 'queue' })).text).done, true);
  clock.t = at(2026, 10, 22, 12, 5);
  const q = parse((await call(ctx, 'studio_posting', { action: 'queue' })).text);
  assert.equal(q.posts.length, 1);
  assert.equal(q.posts[0].text, 'Four kilometres of kerb. That is what a lane looks like.');
  assert.equal(q.posts[0].compose, 'https://x.com/intent/tweet?text=Four%20kilometres%20of%20kerb.%20That%20is%20what%20a%20lane%20looks%20like.', 'opens the composer with her text in it, not her feed');
  assert.equal(q.posts[0].prefilled, true);
  assert.equal(parse((await call(ctx, 'studio_posting', { action: 'queue' })).text).posts.length, 0, 'claimed: a second run cannot post it twice');
  // The skill is about to post something else: blocked.
  const wrong = parse((await call(ctx, 'studio_posting', { action: 'check', post_id: q.posts[0].post_id, text: 'Four kilometres of kerb. That is what a lane looks like. #bikes' })).text);
  assert.equal(wrong.go, false);
  assert.equal(posts(ctx)[0].status, 'blocked');
  assert.match(posts(ctx)[0].reason, /wasn't exactly the text you approved/);
  assert.equal(parse((await call(ctx, 'studio_posting', { action: 'result', post_id: q.posts[0].post_id, status: 'posted' })).text).ok, false, 'a blocked post cannot be reported as posted');
  // The approved text changed after approval (a rewrite landed on the passed draft): not posted.
  ctx.tx((db) => { const d = db.drafts.find((x) => x.id === 2); d.final_text = 'Most squeaks are a clean, a drop of oil and a hug.'; });
  clock.t = at(2026, 10, 22, 16, 5);
  const q2 = parse((await call(ctx, 'studio_posting', { action: 'queue' })).text);
  assert.equal(q2.posts.length, 0);
  assert.equal(posts(ctx)[1].status, 'blocked');
  assert.match(posts(ctx)[1].reason, /text changed after you approved it/);
  assert.equal(draft(ctx, 2).status, 'edited', 'still approved, hers to copy');
});

test('"Post it for me" on an approved draft refuses if the text changed since her board showed it', async () => {
  const { ctx } = setup();
  setAccount(ctx, { action: 'connect', type: 'x' });
  await call(ctx, 'studio_act', { action: 'pass', id: 1, hash: hashOf(ctx, 1) });
  await call(ctx, 'studio_account_posting', { type: 'x', on: true, confirmed: true });
  const seen = hashOf(ctx, 1);
  // A model-side edit lands while her board still shows the old text.
  ctx.tx((db) => { db.drafts.find((x) => x.id === 1).final_text = 'Something she never saw.'; });
  const r = await call(ctx, 'studio_post_schedule', { id: 1, hash: seen });
  assert.match(r.text, /changed since you looked at it/);
  assert.equal(posts(ctx).length, 0);
  const none = await call(ctx, 'studio_post_schedule', { id: 1 });
  assert.match(none.text, /changed since you looked at it/);
  assert.equal(posts(ctx).length, 0);
  await call(ctx, 'studio_post_schedule', { id: 1, hash: hashOf(ctx, 1) });
  assert.equal(posts(ctx)[0].approved_hash, textHash('Something she never saw.'));
});

test('a post that matches goes out and is recorded; the draft is marked posted by Claude', async () => {
  const { ctx, clock } = setup();
  setAccount(ctx, { action: 'connect', type: 'x' });
  await call(ctx, 'studio_account_posting', { type: 'x', on: true, confirmed: true });
  await call(ctx, 'studio_post_schedule', { id: 1, hash: hashOf(ctx, 1) });
  clock.t = at(2026, 10, 22, 12, 5);
  const [p] = parse((await call(ctx, 'studio_posting', { action: 'queue' })).text).posts;
  const ok = parse((await call(ctx, 'studio_posting', { action: 'check', post_id: p.post_id, text: p.text })).text);
  assert.equal(ok.go, true);
  await call(ctx, 'studio_posting', { action: 'result', post_id: p.post_id, status: 'posted', url: 'https://x.com/example/status/9' });
  assert.equal(posts(ctx)[0].status, 'posted');
  assert.equal(draft(ctx, 1).status, 'posted');
  assert.equal(draft(ctx, 1).posted_by, 'claude');
  assert.equal(draft(ctx, 1).post_url, 'https://x.com/example/status/9');
  const v = (await call(ctx, 'studio_view', { view: 'drafts', tab: 'passed' })).sc;
  assert.equal(v.units.find((u) => u.id === 1).post.status, 'posted');
});

test('missed slots and failed posts surface on the board with their reason, and are never retried by themselves', async () => {
  const { ctx, clock } = setup();
  setAccount(ctx, { action: 'connect', type: 'x' });
  await call(ctx, 'studio_account_posting', { type: 'x', on: true, confirmed: true });
  await call(ctx, 'studio_post_schedule', { id: 1, hash: hashOf(ctx, 1) }); // 12:00
  await call(ctx, 'studio_post_schedule', { id: 2, hash: hashOf(ctx, 2) }); // 16:00
  // The laptop slept through 12:00. Opening the board later marks it missed.
  clock.t = at(2026, 10, 22, 12, 0) + (GRACE_MIN + 1) * MIN;
  let v = (await call(ctx, 'studio_view', { view: 'drafts', tab: 'passed' })).sc;
  const missed = v.units.find((u) => u.id === 1).post;
  assert.equal(missed.status, 'missed');
  assert.match(missed.reason, /Nothing ran between 12:00 and 13:00: your computer was asleep or Claude was closed/);
  assert.equal(v.header.posting.missed, 1);
  // 16:00: Claude takes it, then reports a failure.
  clock.t = at(2026, 10, 22, 16, 5);
  const q = parse((await call(ctx, 'studio_posting', { action: 'queue' })).text);
  assert.deepEqual(q.posts.map((p) => p.post_id), [2], 'the missed one is not posted late');
  await call(ctx, 'studio_posting', { action: 'result', post_id: 2, status: 'failed', code: 'not_signed_in', reason: 'x.com showed the sign-in page' });
  v = (await call(ctx, 'studio_view', { view: 'drafts', tab: 'passed' })).sc;
  assert.match(v.units.find((u) => u.id === 2).post.reason, /You weren't signed in.*x\.com showed the sign-in page/);
  assert.deepEqual([v.header.posting.missed, v.header.posting.failed], [1, 1]);
  // Nothing comes back by itself, however often the skill runs.
  for (const h of [17, 20, 23]) { clock.t = at(2026, 10, 22, h, 5); assert.equal(parse((await call(ctx, 'studio_posting', { action: 'queue' })).text).posts.length, 0); }
  // A post Claude took but never reported on is marked failed, with a warning to check first.
  await call(ctx, 'studio_post_schedule', { id: 2, hash: hashOf(ctx, 2), again: true });
  clock.t = at(2026, 10, 23, 8, 5);
  assert.equal(parse((await call(ctx, 'studio_posting', { action: 'queue' })).text).posts.length, 1, 'her tap put it in a new slot');
  clock.t = at(2026, 10, 23, 8, 50);
  v = (await call(ctx, 'studio_view', { view: 'drafts', tab: 'passed' })).sc;
  assert.match(v.units.find((u) => u.id === 2).post.reason, /didn't say whether it worked\. Check X before you try again/);
  // She clears the missed one ("I'll copy it myself"): it leaves the warning, the draft stays approved.
  await call(ctx, 'studio_post_schedule', { dismiss: posts(ctx).find((p) => p.status === 'missed').id });
  v = (await call(ctx, 'studio_view', { view: 'drafts' })).sc;
  assert.equal(v.header.posting.missed, 0);
  assert.equal(draft(ctx, 1).status, 'passed');
});

test('turning posting off, skipping or posting by hand cancels what was scheduled', async () => {
  const { ctx, clock } = setup();
  setAccount(ctx, { action: 'connect', type: 'x' });
  await call(ctx, 'studio_account_posting', { type: 'x', on: true, confirmed: true });
  await call(ctx, 'studio_post_schedule', { id: 1, hash: hashOf(ctx, 1) });
  await call(ctx, 'studio_post_schedule', { id: 2, hash: hashOf(ctx, 2) });
  await call(ctx, 'studio_act', { action: 'mark_posted', id: 2 });
  clock.t = at(2026, 10, 22, 11, 0);
  await call(ctx, 'studio_view', { view: 'drafts' });
  assert.match(posts(ctx)[1].reason, /marked it as posted yourself/);
  const off = await call(ctx, 'studio_account_posting', { type: 'x', on: false });
  assert.match(off.text, /1 scheduled post\(s\) were cancelled/);
  clock.t = at(2026, 10, 22, 12, 5);
  assert.equal(parse((await call(ctx, 'studio_posting', { action: 'queue' })).text).posts.length, 0);
});

test('slots: the next release hour, one post per slot, posts_per_day a day', () => {
  const s = { release_hours: [8, 12, 16, 20], posts_per_day: 2 };
  const a = nextSlot(s, NOW, []);
  assert.equal(new Date(a).getHours(), 12);
  const b = nextSlot(s, NOW, [a]);
  assert.equal(new Date(b).getHours(), 16);
  const c = nextSlot(s, NOW, [a, b]);
  assert.equal(new Date(c).getDate(), 23, 'two today is the most');
  assert.equal(new Date(c).getHours(), 8);
});

test('a prefill address must be https with {text} in it once; types without one open the plain composer', () => {
  const base = { id: 'demo', label: 'Demo', enables: 'x', connect: 'x', capabilities: { read: false, post: true }, compose: 'https://demo.example.com/compose', post_warning: 'w' };
  assert.equal(validateAccountType(base).prefill, null);
  assert.equal(validateAccountType({ ...base, prefill: 'https://demo.example.com/intent?text={text}' }).prefill, 'https://demo.example.com/intent?text={text}');
  for (const bad of ['http://demo.example.com/intent?text={text}', 'https://demo.example.com/intent', 'https://demo.example.com/?a={text}&b={text}', 'https://127.0.0.1/?t={text}'])
    assert.throws(() => validateAccountType({ ...base, prefill: bad }), /prefill/, bad);
});
