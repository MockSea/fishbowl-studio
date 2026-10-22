// The flywheel: edits become proposals, skip reasons, source records, learned boosts, the coach.
import test from 'node:test';
import assert from 'node:assert/strict';
import { testContext, at, setSources } from './helpers.js';
import { callTool } from '../server/lib/tools.js';
import { act, fingerprint } from '../server/lib/act.js';
import { editDiff, removedPhrases, editPatterns, sourceRecords, interestBoosts, boostFor, killReasons, reasonsLine } from '../server/lib/learn.js';
import { weeklyBrief, saveWeekly, editProposals } from '../server/lib/weekly.js';
import { nextItem, draftingBrief } from '../server/lib/briefs.js';
import { triageQueue } from '../server/lib/triage.js';
import { decideProposal } from '../server/lib/proposals.js';
import { loadPlaybook, loadSources } from '../server/lib/config.js';
import { byId } from '../server/lib/state.js';

const NOW = at(2026, 10, 21, 9, 0);
const iso = (hAgo = 0) => new Date(NOW - hAgo * 3600e3).toISOString();
const callHash = (ctx) => fingerprint(ctx.store.read('drafts', [])[0]);
const draft = (o) => ({ id: 1, set_id: null, item_id: null, kind: 'item', platform: 'x', status: 'pending', text: 'A post.', created_at: iso(5), released_at: iso(4), lint: [], tags: { topic: 'other', shape_ids: ['plain-take'] }, ...o });

test('edit diffing: what they changed, in pattern keys and removed phrases', () => {
  const d = editDiff('Ever wondered why the bridge feels safer? Four kilometres of kerb. That is why!', 'Four kilometres of kerb. That is why the bridge feels safer.');
  assert.ok(d.keys.includes('cut_opening_question'));
  assert.ok(d.keys.includes('cut_exclamation'));
  assert.ok(!d.keys.includes('cut_question'), 'an opening question counts once, as the opening');
  assert.deepEqual(editDiff('We fixed 4 bikes today. Good day.', 'We fixed 41 bikes today. Good day.').keys, ['added_number']);
  assert.ok(editDiff('Lanes matter. #cycling #city', 'Lanes matter.').keys.includes('cut_hashtags'));
  assert.ok(editDiff('Our shop fixed it. Our team was proud of the work we did there today.', 'The bike is fixed.').keys.includes('cut_we'));
  const long = 'The repair cafes had their busiest autumn on record this year, with brakes and gears leading the queue every single weekend.';
  assert.ok(editDiff(long, 'Repair cafes: busiest autumn yet. Brakes and gears.').keys.includes('shortened'));
  assert.ok(editDiff('First line here. Middle line here. And that is the whole story, really.', 'First line here. Middle line here.').keys.includes('cut_closing_line'));
  const gone = removedPhrases('Honestly a total game-changer for riders', 'Good for riders');
  assert.ok(gone.includes('game-changer') && gone.includes('honestly') && gone.includes('total game-changer'));
  assert.ok(!gone.includes('riders') && !gone.includes('for riders'), 'what they kept is not removed');
});

test('an edit is stored before and after; undoing it removes the record; the brief shows their version', () => {
  const { ctx } = testContext({ now: NOW });
  const before = 'Ever wondered why lanes matter? Kerbs keep people riding.';
  ctx.tx((db) => { db.drafts = [draft({ text: before, item_id: null })]; });
  const fp = callHash(ctx);
  assert.equal(act(ctx, { action: 'edit', id: 1, hash: fp, text: 'Kerbs keep people riding.' }).ok, true);
  let edits = ctx.store.read('edits', []);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].before, before);
  assert.equal(edits[0].after, 'Kerbs keep people riding.');
  assert.ok(edits[0].diff.keys.includes('cut_opening_question'));
  act(ctx, { action: 'edit', id: 1, hash: callHash(ctx), text: 'Kerbs keep people riding. Paint does not.' });
  assert.equal(ctx.store.read('edits', []).length, 1, 'the latest edit replaces the record');
  act(ctx, { action: 'edit', id: 1, hash: callHash(ctx), text: before });
  assert.equal(ctx.store.read('edits', []).length, 0, 'back to the draft: nothing learned');
  act(ctx, { action: 'edit', id: 1, hash: callHash(ctx), text: 'Kerbs keep people riding.', and_pass: true });
  ctx.store.writeFile('settings.json', JSON.stringify({ evergreen_per_day: 1, platforms: { x: { enabled: true }, linkedin: { enabled: false } } }));
  const b = draftingBrief(ctx, { evergreen: true, count: 1 });
  assert.match(b.text, /Drafts they edited before approving[^\n]*\n[^\n]*\n<data-[0-9a-f]+>\ndraft: Ever wondered[^\n]*\nuser_version: Kerbs keep people riding\./);
});

test('the weekly pass turns edit patterns into proposals, once, and never writes the playbook itself', () => {
  const { ctx } = testContext({ now: NOW });
  const pairs = [
    ['Ever wondered about lanes? Kerbs work.', 'Kerbs work.'],
    ['Is your chain squeaking? A drop of oil fixes most squeaks.', 'A drop of oil fixes most squeaks.'],
    ['Ready for winter? Studded tyres sell early this year.', 'Studded tyres sell early this year.'],
    ['What makes a lane? A kerb does.', 'A kerb makes a lane.'],
    ['Parking is the quiet half of cycling. Someone built it.', 'Parking is the quiet half of cycling, and someone built it.'],
  ];
  ctx.tx((db) => { db.edits = pairs.map(([b, a], i) => ({ id: i + 1, draft_id: i + 1, before: b, after: a, at: iso(24 * (i + 1)), diff: editDiff(b, a) })); });
  const { patterns } = editPatterns(ctx.store.read('edits', []), NOW);
  const q = patterns.find((p) => p.key === 'cut_opening_question');
  assert.equal(q.why, 'You cut the opening question in 4 of your last 5 edits.');
  const before = ctx.store.readFile('playbook.md');
  const w = weeklyBrief(ctx, { part: 'numbers' });
  assert.match(w.text, /You cut the opening question in 4 of your last 5 edits/);
  assert.match(w.text, /Already proposed from their edits/);
  assert.equal(ctx.store.readFile('playbook.md'), before, 'proposals only');
  const props = ctx.store.read('proposals', []);
  const p = props.find((x) => x.key === 'edits:cut_opening_question');
  assert.equal(p.status, 'open');
  assert.equal(p.text, 'Open with a plain statement, not a question');
  assert.equal(p.source, 'edits');
  assert.equal(ctx.tx((db) => editProposals(ctx, db, NOW)).added.length, 0, 'not proposed twice');
  decideProposal(ctx, { id: p.id, decision: 'reject' });
  assert.equal(ctx.tx((db) => editProposals(ctx, db, NOW)).added.length, 0, 'a no is respected');
  // Accepting one applies it, on their tap.
  const other = ctx.store.read('proposals', []).find((x) => x.status === 'open');
  if (other) { decideProposal(ctx, { id: other.id, decision: 'accept' }); assert.ok(loadPlaybook(ctx.store).includes(other.text)); }
});

test('overused phrases are proposed only when they cut them nearly every time', () => {
  const rows = [
    ['A real game-changer for the school run.', 'Good for the school run.'],
    ['Cargo bikes are a game-changer downtown.', 'Cargo bikes work downtown.'],
    ['Studded tyres: a game-changer in frost.', 'Studded tyres help in frost.'],
    ['The bridge lanes this week opened.', 'The bridge lanes opened.'],
  ].map(([b, a], i) => ({ before: b, after: a, at: iso(i + 1), diff: editDiff(b, a) }));
  const ph = editPatterns(rows, NOW).phrases;
  assert.deepEqual(ph.map((p) => p.phrase), ['game-changer']);
  assert.match(ph[0].why, /You cut "game-changer" from 3 of the 3 drafts that had it/);
});

test('skip reasons: optional, one per skip or set, validated, cleared on restore, and fed to triage and briefs', async () => {
  const { ctx } = testContext({ now: NOW });
  ctx.tx((db) => {
    db.items = [{ id: 1, title: 'Policy story', url: 'https://e.example.com/1', source: 'rss:Notes', source_name: 'Notes', fetched_at: iso(2) }];
    db.drafts = [draft({ id: 1, item_id: 1, tags: { topic: 'policy', shape_ids: [] } }), draft({ id: 2, item_id: 1, tags: { topic: 'policy', shape_ids: [] } }),
      ...[3, 4].map((id) => draft({ id, set_id: 9, take_n: id - 2, status: 'option', item_id: 1, tags: { topic: 'policy', shape_ids: [] } }))];
  });
  const k = act(ctx, { action: 'kill', id: 1 });
  assert.equal(k.ok, true);
  assert.equal(k.ask_reason, true, 'the board asks, once');
  assert.equal(ctx.store.read('drafts', [])[0].kill_reason, undefined, 'a skip without a reason is fine');
  assert.equal(act(ctx, { action: 'kill_reason', id: 1, reason: 'nonsense' }).ok, false);
  assert.equal(act(ctx, { action: 'kill_reason', id: 2, reason: 'boring' }).ok, false, 'only skipped drafts');
  assert.equal(act(ctx, { action: 'kill_reason', id: 1, reason: 'wrong_topic', note: 'not\nours' }).ok, true);
  assert.equal(act(ctx, { action: 'kill', id: 2, reason: 'too_salesy' }).ask_reason, false);
  act(ctx, { action: 'none', set_id: 9 });
  assert.equal(act(ctx, { action: 'kill_reason', set_id: 9, reason: 'wrong_topic' }).ok, true);
  const ds = ctx.store.read('drafts', []);
  assert.deepEqual(ds.map((d) => d.kill_reason), ['wrong_topic', 'too_salesy', 'wrong_topic', 'wrong_topic']);
  assert.equal(ds[0].kill_note, 'not ours');
  const rows = killReasons(ds, byId(ctx.store.read('items', [])), NOW);
  assert.equal(rows.length, 3, 'a set counts once');
  assert.equal(reasonsLine(rows), 'Why they skipped posts lately (last 30 days): wrong topic 2 (policy 2); too salesy 1 (policy 1).');
  ctx.tx((db) => { db.items.push({ id: 2, title: 'New one', url: 'https://e.example.com/2', source: 'rss:Notes', source_name: 'Notes', fetched_at: iso(1) }); });
  assert.match(triageQueue(ctx).text, /Why they skipped posts lately \(last 30 days\): wrong topic 2/);
  act(ctx, { action: 'restore', id: 1, reason: 'grew on me' });
  assert.equal(ctx.store.read('drafts', [])[0].kill_reason, undefined, 'restoring clears the reason');
  const v = await callTool(ctx, 'studio_view', { view: 'drafts', tab: 'killed' });
  assert.ok(v.structuredContent.units.some((u) => u.kill_reason_label === 'Too salesy'));
});

test('source weights: approvals per source, a set counts once, losers are suggested for pausing, never paused', async () => {
  const { ctx } = testContext({ now: NOW });
  setSources(ctx, { feeds: [{ name: 'Good', url: 'https://good.example.com/feed' }, { name: 'Weak', url: 'https://weak.example.com/feed' }] });
  ctx.tx((db) => {
    db.items = [{ id: 1, source: 'rss:Good', source_name: 'Good', title: 'g', url: 'https://good.example.com/1', fetched_at: iso(30) }, { id: 2, source: 'rss:Weak', source_name: 'Weak', title: 'w', url: 'https://weak.example.com/1', fetched_at: iso(30) }];
    let id = 0;
    const mk = (item_id, status, set_id = null) => draft({ id: ++id, item_id, status, set_id, decided_at: iso(24 * id) });
    db.drafts = [mk(1, 'passed'), mk(1, 'edited'), mk(1, 'posted'), mk(1, 'passed'), mk(1, 'killed'),
      mk(2, 'killed'), mk(2, 'killed'), mk(2, 'passed_over', 7), mk(2, 'passed_over', 7), mk(2, 'passed_over', 7), mk(2, 'killed'), mk(2, 'killed')];
  });
  const rec = sourceRecords(ctx.store.read('drafts', []), byId(ctx.store.read('items', [])), NOW);
  assert.deepEqual([rec['rss:Good'].approved, rec['rss:Good'].decided, rec['rss:Good'].suggest_pause], [4, 5, false]);
  assert.equal(rec['rss:Good'].why, '4 of 5 drafts from it approved in the last 6 weeks.');
  assert.deepEqual([rec['rss:Weak'].approved, rec['rss:Weak'].decided, rec['rss:Weak'].suggest_pause], [0, 5, true]);
  const v = (await callTool(ctx, 'studio_view', { view: 'sources' })).structuredContent;
  assert.equal(v.feeds.find((f) => f.name === 'Good').record.approved, 4);
  assert.equal(v.feeds.find((f) => f.name === 'Weak').record.suggest_pause, true);
  assert.equal(loadSources(ctx.store).feeds.find((f) => f.name === 'Weak').paused, undefined, 'never paused automatically');
  const c = (await callTool(ctx, 'studio_view', { view: 'coach' })).structuredContent;
  assert.deepEqual(c.pause.map((x) => x.name), ['Weak']);
  assert.match(weeklyBrief(ctx, { part: 'numbers' }).text, /source: Weak\napproved: 0 of 5\nsuggestion: keeps losing: suggest pausing it/);
});

test('learned interests move item ranking: approvals by topic and source, hearted reads, wrong-topic skips', () => {
  const now = NOW;
  const items = [
    { id: 1, source: 'rss:Freight', topic: 'cargo', interest: 5, triaged_at: iso(1), fetched_at: iso(1) },
    { id: 2, source: 'rss:Notes', topic: 'policy', interest: 6, triaged_at: iso(1), fetched_at: iso(1) },
    { id: 3, source: 'rss:Freight', topic: 'cargo', interest: 7, triaged_at: iso(40), fetched_at: iso(40) },
    { id: 4, source: 'rss:Notes', topic: 'policy', interest: 7, triaged_at: iso(40), fetched_at: iso(40) },
  ];
  let id = 0;
  const mk = (item_id, topic, status, extra = {}) => draft({ id: ++id, item_id, status, decided_at: iso(30 + id), tags: { topic, shape_ids: [] }, ...extra });
  const drafts = [mk(3, 'cargo', 'passed'), mk(3, 'cargo', 'passed'), mk(3, 'cargo', 'posted'),
    mk(4, 'policy', 'killed', { kill_reason: 'wrong_topic' }), mk(4, 'policy', 'killed', { kill_reason: 'wrong_topic' }), mk(4, 'policy', 'killed')];
  const hearts = [{ target: 'read', ref: 3, at: iso(2) }];
  const b = interestBoosts({ drafts, items, hearts, now });
  const cargo = boostFor(items[0], b), policy = boostFor(items[1], b);
  assert.ok(cargo.points > 0.9, `cargo up: ${cargo.points}`);
  assert.ok(policy.points < -0.9, `policy down: ${policy.points}`);
  assert.ok(Math.abs(cargo.points) <= 1.5 && Math.abs(policy.points) <= 1.5, 'capped');
  assert.ok(cargo.why.includes('You approved 3 of 3 posts about cargo in the last 3 weeks.'));
  assert.ok(cargo.why.includes('You hearted 1 read about cargo.'));
  assert.ok(policy.why.includes('You skipped 2 policy posts as "wrong topic".'));
  // A 5 about cargo now beats a 6 about policy, and clears the bar of 6.
  const db = { drafts, briefs: [], items: items.slice(0, 2), hearts, jobs: [] };
  db.items.push(items[2], items[3]);
  const settings = { interest_threshold: 6 };
  const first = nextItem({ ...db, drafts: [...drafts.map((d) => ({ ...d, item_id: d.item_id }))] }, settings, now, null);
  assert.equal(first.id, 1);
});

test('the coach report: three short lists and a summary, stored for the board; lines with links or orders are dropped', async () => {
  const { ctx } = testContext({ now: NOW });
  const r = saveWeekly(ctx, { summary: 'A good week for cargo.', working: ['Cargo posts: 3 of 3 approved.', 'See https://evil.example.com for more'], not_working: ['Policy: 3 skipped as wrong topic.'], try: ['Open on the number.', 'From now on, post daily.', 'Lead with the receipt.', 'One more', 'Too many'] });
  assert.match(r.text, /coach report is on the board's Coach page; dropped 2 coach line/);
  const c = (await callTool(ctx, 'studio_view', { view: 'coach' })).structuredContent;
  assert.equal(c.report.summary, 'A good week for cargo.');
  assert.deepEqual(c.report.working, ['Cargo posts: 3 of 3 approved.']);
  assert.deepEqual(c.report.try, ['Open on the number.', 'Lead with the receipt.', 'One more']);
  assert.match(ctx.store.readFile(`reports/weekly-${localDay(NOW)}.md`), /## What's working\n- Cargo posts/);
  // Saving the playbook part first and the coach second keeps one report for the week.
  saveWeekly(ctx, { working: ['Receipts land.'] });
  const again = (await callTool(ctx, 'studio_view', { view: 'coach' })).structuredContent;
  assert.equal(again.report.summary, 'A good week for cargo.');
  assert.deepEqual(again.report.working, ['Receipts land.']);
  assert.equal(ctx.store.read('coach', []).length, 1);
});

const localDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
