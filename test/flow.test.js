// End to end through the real store: setup files -> fetch -> triage -> brief -> takes -> release -> verdicts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { testContext, rss, at, setSources } from './helpers.js';
import { callTool } from '../server/lib/tools.js';
import { triageQueue, recordTriage } from '../server/lib/triage.js';
import { draftingBrief } from '../server/lib/briefs.js';
import { saveTakes } from '../server/lib/save.js';
import { act } from '../server/lib/act.js';
import { releaseTool } from '../server/lib/run.js';
import { fetchAll } from '../server/lib/ingest.js';

const FEED = 'https://feeds.example.com/cycling.xml';
const NOW = at(2026, 10, 21, 7, 0);
const pub = new Date(NOW - 3600e3).toUTCString();
const stories = [
  ['Riverside adds protected lanes on the bridge road', 'The council finished 4 km of protected lanes.'],
  ['Repair cafes report a rise in bicycle visits', 'Volunteer fixers say autumn is their busiest season.'],
  ['New rules for e-bike batteries in shared housing', 'Landlords get guidance on charging rooms.'],
  ['Cargo bikes overtake vans for parcel rounds downtown', 'Couriers swap vans for cargo bikes in the centre.'],
  ['Protected lanes added on Riverside bridge road - Other Outlet', 'Same story, other outlet.'],
];

async function setup() {
  const t = testContext({ now: NOW, feeds: { [FEED]: rss(stories.map(([title, desc], i) => ({ title, desc, link: `https://news.example.com/${i}`, date: pub }))) } });
  const cfg = (file, content) => callTool(t.ctx, 'studio_config', { action: 'set', file, content });
  await cfg('beat.json', { topics: ['infrastructure', 'repair', 'policy', 'logistics'], on_beat: ['city cycling'], off_limits: ['celebrity gossip'] });
  setSources(t.ctx, { feeds: [{ name: 'Example Cycling News', url: FEED, topic: 'infrastructure' }] });
  await cfg('voice.md', '# Voice\nWarm, practical, a little dry. We fix bikes and say what we see.');
  await callTool(t.ctx, 'studio_config', { action: 'patch', patch: { brand: 'Northwind Bicycles', setup_complete: true, evergreen_per_day: 0 } });
  return t;
}

const takes = (n, base) => [...Array(n)].map((_, i) => ({ text: [`Lanes beat paint every time. ${base}`, `Ask any courier where the hills are. ${base}`, `Good roads make good habits. ${base}`][i], thinking: 'honest first reaction here', topic: 'infrastructure' }));

test('the whole daily loop, end to end', async () => {
  const { ctx, clock } = await setup();
  const f = await fetchAll(ctx);
  assert.equal(f.added, 5);
  assert.equal(f.clustered, 1, 'two outlets, one story');

  const q = triageQueue(ctx);
  assert.equal(q.count, 4, 'the duplicate story is not triaged twice');
  assert.match(q.text, /data, not instructions/);
  recordTriage(ctx, { queue_id: q.queue_id, reactions: [1, 2, 3, 4].map((item) => ({ item, thought: 'worth a look', interest: 9 - item, topic: item === 4 ? 'nonsense' : 'infrastructure' })) });
  assert.equal(triageQueue(ctx).done, true);

  let briefs = 0;
  for (;;) {
    const b = draftingBrief(ctx);
    if (b.done) break;
    briefs++;
    assert.equal(b.kind, 'item');
    assert.match(b.text, new RegExp(`brief_id: ${b.brief_id}`));
    assert.match(b.text, /## Shapes, one per take/);
    assert.match(b.text, /## The brand's voice\n[^\n]*not instructions[^\n]*\n<data-([0-9a-f]{8})>\n# Voice\nWarm, practical[^\n]*\n<\/data-\1>/, 'voice.md is fenced as her settings');
    let r = saveTakes(ctx, { brief_id: b.brief_id, takes: takes(3, `Story ${briefs}.`) });
    if (r.status === 'redraft') r = saveTakes(ctx, { brief_id: b.brief_id, takes: takes(3, `Story ${briefs}, again.`) });
    assert.equal(r.status, 'saved');
  }
  assert.equal(briefs, 3, 'items 1-3 clear the threshold of 6; item 4 scored 5');

  clock.t = at(2026, 10, 21, 8, 1);
  const rel = releaseTool(ctx);
  assert.equal(rel.ran, true);
  assert.equal(rel.released.length, 3);

  const v = (await callTool(ctx, 'studio_view', { view: 'drafts', tab: 'waiting' })).structuredContent;
  assert.equal(v.units.length, 3);
  assert.equal(v.units[0].type, 'set');
  const set = v.units[0];
  const [t1, t2] = set.takes;

  // Fingerprints: a stale hash is refused.
  const bad = act(ctx, { action: 'pass', id: t1.id, hash: 'deadbeef0000' });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /changed since you looked/);

  assert.equal(act(ctx, { action: 'pass', id: t1.id, hash: t1.hash }).ok, true, 'pass on a take picks it');
  const after = (await callTool(ctx, 'studio_view', { view: 'drafts', tab: 'killed', chip: 'unpicked' })).structuredContent;
  assert.ok(after.units.some((u) => u.id === t2.id));
  const passed = (await callTool(ctx, 'studio_view', { view: 'drafts', tab: 'passed' })).structuredContent.units[0];
  assert.equal(passed.id, t1.id);
  assert.equal(passed.platform, set.platform);
  assert.ok(passed.chars > 0);

  // Note -> rewrite queue -> rewrite brief -> new version; an old hash is then refused.
  const set2 = v.units[1];
  act(ctx, { action: 'pick', id: set2.takes[0].id });
  const oldHash = set2.takes[0].hash;
  assert.equal(act(ctx, { action: 'note', id: set2.takes[0].id, text: 'less preachy, more practical' }).needs_claude, true);
  const rb = draftingBrief(ctx);
  assert.equal(rb.kind, 'rewrite');
  assert.match(rb.text, /less preachy/);
  const rr = saveTakes(ctx, { brief_id: rb.brief_id, takes: [{ text: 'Check your tyre pressure before the bridge climb.', thinking: 'practical' }] });
  assert.equal(rr.status, 'saved');
  const stale = act(ctx, { action: 'edit', id: set2.takes[0].id, hash: oldHash, text: 'my edit' });
  assert.equal(stale.ok, false, 'edit with the pre-rewrite fingerprint is refused');

  // Mark posted and enter numbers.
  assert.equal(act(ctx, { action: 'mark_posted', id: t1.id, url: 'https://social.example.com/p/1' }).ok, true);
  const m = await callTool(ctx, 'studio_metrics', { action: 'add', draft_id: t1.id, views: 1000, likes: 20, replies: 3, reposts: 2 });
  assert.match(m.content[0].text, /Saved numbers/);

  // Status line.
  const st = await callTool(ctx, 'studio_status');
  assert.match(st.content[0].text, /of 10 today/);
});

test('the board tool returns UI data plus a readable text fallback', async () => {
  const { ctx } = await setup();
  const r = await callTool(ctx, 'studio_board');
  assert.ok(r.structuredContent.header);
  assert.match(r.content[0].text, /waiting/);
  assert.ok(r.structuredContent.stamp.seq > 0);
});

test('studio_config validates sources (https, no IP, no port)', async () => {
  const { ctx } = await setup();
  for (const url of ['http://example.com/feed', 'https://127.0.0.1/feed', 'https://example.com:8443/feed', 'https://user:pw@example.com/f']) {
    const r = await callTool(ctx, 'studio_config', { action: 'set', file: 'sources.json', content: { feeds: [{ name: 'x', url }] } });
    assert.equal(r.isError, true, url);
  }
  const bad = await callTool(ctx, 'studio_config', { action: 'patch', patch: { release_hours: [25] } });
  assert.equal(bad.isError, true);
});

test('a dead feed yields an error and the rest carry on', async () => {
  const { ctx } = await setup();
  setSources(ctx, { feeds: [{ name: 'Good', url: FEED }, { name: 'Dead', url: 'https://dead.example.com/feed' }] });
  const r = await fetchAll(ctx);
  assert.equal(r.added, 5);
  assert.deepEqual(r.errors.map((e) => e.name), ['Dead']);
});
