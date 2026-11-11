// What a run can cost. Work the model keeps getting wrong (every take dropped, too few takes, a
// refusal) is closed once and never asked for again, one run makes at most MAX_CALLS_PER_RUN
// model calls, one tick of the timer at most MAX_CALLS_PER_TICK, and a tick with nothing due
// makes none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rss, at, setSources } from './helpers.js';
import { KEY, app, setUpBrand, fetchImpl } from './desktop-helpers.js';
import { makeModel, SCHEMAS } from '../desktop/llm.js';
import { MAX_CALLS_PER_RUN } from '../desktop/runner.js';
import { MAX_CALLS_PER_TICK } from '../desktop/host.js';
import { callTool } from '../server/lib/tools.js';

const FIVE_MIN = 5 * 60e3;
const tooLong = (n = 3) => [...Array(n)].map(() => ({ text: 'Far too long. '.repeat(600), thinking: 'x', topic: 'infrastructure', cites: [] }));
const takesCalls = (api) => api.requests.filter((p) => p.output_config.format.schema === SCHEMAS.takes);
const story = (p) => { const t = p.messages[0].content.at(-1).text; return / · evergreen · /.test(t) ? 'evergreen' : t.match(/\ntitle: ([^\n]+)/)?.[1]; };
const settings = (host, patch) => callTool(host.ctx, 'studio_config', { action: 'patch', patch });

async function ticks(host, clock, n) {
  let calls = 0;
  for (let i = 0; i < n; i++) { clock.t += FIVE_MIN; calls += (await host.tick()).calls; }
  return calls;
}

test('a story whose takes are always dropped is drafted once: two calls, then never again', async () => {
  const { host, api, clock } = await app({ answer: (_task) => tooLong(3) });
  await host.keySet(KEY);
  await setUpBrand(host);
  await settings(host, { evergreen_per_day: 1 });

  const first = await host.ask('Run the Fishbowl Studio daily run now.').done;
  assert.equal(first.ok, true, first.message);
  assert.equal(first.drafts, 0);
  const perStory = {};
  for (const p of takesCalls(api)) perStory[story(p)] = (perStory[story(p)] || 0) + 1;
  assert.equal(Object.keys(perStory).length, 3, 'two stories and the evergreen set');
  for (const [k, n] of Object.entries(perStory)) assert.ok(n <= 2, `${k}: ${n} calls`);
  assert.ok(first.calls <= MAX_CALLS_PER_RUN);

  // The same day again: nothing new, and the dropped work stays used up.
  const before = api.requests.length;
  const again = await host.ask('Run the Fishbowl Studio daily run now.').done;
  assert.equal(again.ok, true, again.message);
  assert.equal(takesCalls(api).length, Object.values(perStory).reduce((a, b) => a + b, 0), 'no new drafting calls');
  assert.equal(api.requests.length, before);

  // Autorun on, two hours of ticks: the news isn't due, nothing is queued, so no calls.
  host.prefsSet({ autorun: true });
  assert.equal(await ticks(host, clock, 24), 0);
  assert.equal(api.requests.length, before);
});

test('an evergreen set that comes back short twice is closed, and ticks do not reopen it', async () => {
  const { host, api, clock } = await app({ answer: (task) => (/evergreen posts/.test(task) ? tooLong(1).map((t) => ({ ...t, text: 'Short and fine.' })) : undefined) });
  await host.keySet(KEY);
  await setUpBrand(host);
  await settings(host, { evergreen_per_day: 2 });

  const r = await host.ask('Run the Fishbowl Studio daily run now.').done;
  assert.equal(r.ok, true, r.message);
  const evergreen = () => takesCalls(api).filter((p) => /evergreen posts/.test(p.messages[0].content.at(-1).text)).length;
  assert.equal(evergreen(), 2, 'asked once, then once more for the missing take');
  const brief = host.ctx.tx((db) => db.briefs.find((b) => b.kind === 'evergreen'));
  assert.equal(brief.done, true);
  assert.equal(brief.dropped, true);

  await host.ask('Run the Fishbowl Studio daily run now.').done;
  host.prefsSet({ autorun: true });
  await ticks(host, clock, 24);
  assert.equal(evergreen(), 2);
});

test('a refused brief is closed, so its job is not retried every tick', async () => {
  let refuse = true;
  const { host, api, clock } = await app({
    createModel: () => {
      const inner = makeModel({ create: async (p) => (refuse && p.output_config.format.schema === SCHEMAS.takes ? { stop_reason: 'refusal', content: [] } : api.create(p)) });
      return inner;
    },
  });
  await host.keySet(KEY);
  await setUpBrand(host);
  const r = await host.ask('Run the Fishbowl Studio daily run now.').done;
  assert.equal(r.ok, true, r.message);
  const open = host.ctx.tx((db) => db.briefs.filter((b) => !b.done).length);
  assert.equal(open, 0, 'every refused brief was closed');
  const n = api.requests.length;
  host.prefsSet({ autorun: true });
  await ticks(host, clock, 12);
  assert.equal(api.requests.length, n);
});

test('one run and one tick are capped, however much work is waiting', async () => {
  const FEED = 'https://feeds.example.com/busy.xml';
  const pub = new Date(at(2026, 10, 21, 6, 0)).toUTCString();
  const words = ['harbour', 'tram', 'orchard', 'library', 'glacier', 'violin', 'market', 'lantern', 'meadow', 'quarry', 'canal', 'pottery', 'comet', 'ferry', 'bakery', 'tunnel', 'falcon', 'museum', 'garden', 'salmon', 'cinema', 'pepper', 'island', 'kettle', 'marble', 'forest', 'rocket', 'saddle', 'thimble', 'walnut'];
  const more = ['amber', 'birch', 'cobalt', 'delta', 'ember', 'fjord', 'granite', 'hazel', 'indigo', 'juniper', 'kelp', 'lilac', 'maple', 'nectar', 'onyx', 'pumice', 'quartz', 'russet', 'sienna', 'topaz', 'umber', 'velvet', 'willow', 'xenon', 'yarrow', 'zinnia', 'acorn', 'basalt', 'cedar', 'dune'];
  const xml = rss(words.map((w, i) => ({ title: `${w[0].toUpperCase()}${w.slice(1)} ${more[i]} opens`, desc: `About the ${w}.`, link: `https://news.example.com/b${i}`, date: pub })));
  const fetch = async (url) => (url === FEED ? { ok: true, status: 200, url, headers: new Map(), text: async () => xml } : fetchImpl(url));
  const { host, api, clock, events } = await app({ answer: () => tooLong(3), fetch });
  await host.keySet(KEY);
  await setUpBrand(host);
  setSources(host.ctx, { feeds: [{ name: 'Busy News', url: FEED, topic: 'infrastructure', limit: 40 }] });
  host.ctx.store.writeFile('settings.json', JSON.stringify({ ...JSON.parse(host.ctx.store.readFile('settings.json')), drafts_per_run: 30, evergreen_per_day: 2 }));

  host.prefsSet({ autorun: true });
  const t1 = await host.tick();
  assert.ok(t1.calls > 0);
  assert.ok(t1.calls <= MAX_CALLS_PER_TICK, `tick made ${t1.calls} calls`);
  assert.ok(t1.calls <= MAX_CALLS_PER_RUN);
  assert.equal(api.requests.length, t1.calls);
  assert.match(events.at(-1).message, /limit of model calls/);

  // The next tick: news not due, nothing queued. No calls.
  clock.t += FIVE_MIN;
  assert.equal((await host.tick()).calls, 0);

  // A day later the news is due again: another capped run, and no story is drafted twice.
  clock.t = at(2026, 10, 22, 7, 0);
  const t2 = await host.tick();
  assert.ok(t2.calls <= MAX_CALLS_PER_TICK);
  const perStory = {};
  for (const p of takesCalls(api)) { const s = story(p); if (s !== 'evergreen') perStory[s] = (perStory[s] || 0) + 1; }
  for (const [k, n] of Object.entries(perStory)) assert.ok(n <= 2, `${k}: ${n} calls`);
  assert.equal(api.requests.length, t1.calls + t2.calls);
});

test('a triage batch the model refuses is closed at interest 0 and the run still drafts', async () => {
  for (const kind of ['refusal', 'max_tokens', 'parse']) {
    const bad = { refusal: { stop_reason: 'refusal', content: [] }, max_tokens: { stop_reason: 'max_tokens', content: [] }, parse: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] } }[kind];
    let api;
    const made = await app({
      createModel: () => makeModel({ create: async (p) => (p.output_config.format.schema === SCHEMAS.triage ? (api.requests.push(p), bad) : api.create(p)) }),
    });
    api = made.api;
    const { host, clock } = made;
    await host.keySet(KEY);
    await setUpBrand(host);
    await settings(host, { evergreen_per_day: 1 });

    const r = await host.ask('Run the Fishbowl Studio daily run now.').done;
    assert.equal(r.ok, true, `${kind}: ${r.message}`);
    assert.equal(r.drafts, 1, `${kind}: the evergreen post is still drafted`);
    const triageCalls = () => api.requests.filter((p) => p.output_config.format.schema === SCHEMAS.triage).length;
    assert.equal(triageCalls(), 1, `${kind}: one batch, one call`);
    const items = host.ctx.tx((db) => db.items.filter((i) => !i.explore && !i.duplicate_of));
    assert.ok(items.length > 0);
    for (const i of items) { assert.ok(i.triaged_at, `${kind}: ${i.title} closed`); assert.equal(i.interest, 0); }
    assert.equal(takesCalls(api).filter((p) => story(p) !== 'evergreen').length, 0, `${kind}: no story drafted at interest 0`);

    // A queued job makes the timer do a real run; the batch is not offered again.
    host.ctx.tx((db) => { db.jobs.push({ id: host.ctx.id('job'), kind: 'draft_item', item_id: items[0].id, status: 'queued', created_at: host.ctx.iso() }); });
    host.prefsSet({ autorun: true });
    const before = takesCalls(api).length;
    await ticks(host, clock, 24);
    assert.ok(takesCalls(api).length > before, `${kind}: the tick ran and drafted the job`);
    assert.equal(triageCalls(), 1, `${kind}: ticks do not retry the batch`);
  }
});

test('a tick still running makes the next one a no-op', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let api;
  const made = await app({ createModel: () => makeModel({ create: async (p) => { await gate; return api.create(p); } }) });
  api = made.api;
  const { host } = made;
  await host.keySet(KEY);
  await setUpBrand(host);
  host.prefsSet({ autorun: true });

  const first = host.tick();
  await new Promise((r) => setTimeout(r, 20));
  const second = await host.tick();
  assert.deepEqual(second, { calls: 0, skipped: true });
  release();
  const t1 = await first;
  assert.ok(t1.calls > 0);
  assert.ok(!t1.skipped);
  assert.equal(api.requests.length, t1.calls);
  // Once it is done, ticks run again.
  assert.equal((await host.tick()).skipped, undefined);
});
