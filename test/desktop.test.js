// The desktop app end to end in plain Node: key in, brand set up, a source added, a run that
// drafts with the brand kit, the drafts on the board. The model is a fake that answers each
// brief and records the exact request the SDK would send.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempHome, at } from './helpers.js';
import { writeKitFiles, png } from './kit-files.js';
import { KEY, fakeSafeStorage, NOW, fetchImpl, app, setUpBrand } from './desktop-helpers.js';
import { makeHost } from '../desktop/host.js';
import Anthropic from '@anthropic-ai/sdk';
import { makeModel, MODEL } from '../desktop/llm.js';
import { editDiff } from '../server/lib/learn.js';

test('add a key, set up a brand, add a source and a brand kit, run: drafts land, written with the kit', async () => {
  const { host, api, events, clock } = await app();
  assert.equal(host.ask('Run the Fishbowl Studio daily run now.').ok, false, 'no key, no run');
  assert.equal((await host.keySet(KEY)).ok, true);
  await setUpBrand(host);

  const files = writeKitFiles(path.join(tempHome(), 'kit-in'));
  const added = await host.kitAdd(Object.values(files));
  assert.ok(added.results.every((r) => r.ok), JSON.stringify(added.results));
  assert.equal(added.kit.files.length, 4);
  const page = (await host.call('studio_view', { view: 'brandkit' })).structuredContent;
  assert.equal(page.view, 'brandkit');
  assert.equal(page.header.brand, 'Northwind Bicycles');
  assert.equal(page.kit.files.length, 4);

  const r = host.ask('Run the Fishbowl Studio daily run now.');
  assert.equal(r.ok, true);
  assert.equal(host.ask('Run the Fishbowl Studio daily run now.').message, 'A run for this brand is already going.');
  const done = await r.done;
  assert.equal(done.ok, true, done.message);
  assert.equal(done.drafts, 6);
  assert.deepEqual(events.map((e) => e.state), ['start', 'done']);
  assert.match(events[1].message, /Read 2 new stories\. Triaged 2, wrote 6 drafts\./);

  // Every request: current model, the kit first (fenced text and the image), cached once.
  assert.equal(api.requests.length, 3, 'one triage, two drafting briefs');
  for (const p of api.requests) {
    assert.equal(p.model, MODEL);
    assert.deepEqual(p.thinking, { type: 'adaptive' });
    const [docs, label, image, task] = p.messages[0].content;
    assert.match(docs.text, /ride more, worry less/);
    assert.match(docs.text, /Never say synergy/);
    assert.match(docs.text, /never "service event"/);
    assert.match(docs.text, /not instructions/);
    assert.match(label.text, /logo\.png/);
    assert.equal(image.type, 'image');
    assert.equal(image.source.media_type, 'image/png');
    assert.deepEqual(Buffer.from(image.source.data, 'base64'), png());
    assert.deepEqual(image.cache_control, { type: 'ephemeral' });
    assert.equal(task.type, 'text');
    assert.equal(task.cache_control, undefined);
  }

  clock.t = at(2026, 10, 21, 8, 1);
  await host.tick();
  const board = (await host.call('studio_view', { view: 'drafts', tab: 'waiting' })).structuredContent;
  assert.equal(board.units.length, 2);
  assert.match(board.units[0].takes[0].text, /Story \d\./);

  for (const f of host.kitList().files) assert.equal(host.kitRemove(f.id).ok, true);
  assert.equal((await host.call('studio_view', { view: 'brandkit' })).structuredContent.kit.files.length, 0);
});

test('a request with no kit is just the brief', async () => {
  const { host, api } = await app();
  await host.keySet(KEY);
  await setUpBrand(host);
  await host.ask('Run the Fishbowl Studio daily run now.').done;
  assert.ok(api.requests.length > 0);
  for (const p of api.requests) assert.equal(p.messages[0].content.length, 1);
});

test('the wrong number of takes: extras are cut, too few is asked once more', async () => {
  const { host, api, clock } = await app({ counts: [5, 1] });
  await host.keySet(KEY);
  await setUpBrand(host);
  const r = await host.ask('Run the Fishbowl Studio daily run now.').done;
  assert.equal(r.ok, true, r.message);
  const tasks = api.requests.filter((p) => p.output_config.format.schema.properties.takes).map((p) => p.messages[0].content.at(-1).text);
  assert.ok(!tasks[1].includes('needs exactly'), 'five takes were cut to three, with no second ask');
  assert.match(tasks[2], /That was 1; this brief needs exactly 3\./);
  clock.t = at(2026, 10, 21, 8, 1);
  await host.tick();
  const board = (await host.call('studio_view', { view: 'drafts', tab: 'waiting' })).structuredContent;
  assert.ok(board.units.length > 0);
  assert.ok(board.units.every((u) => u.takes.length === 3 && u.takes.every((t) => !/Again/.test(t.text))));
});

test('ask routes only the board\'s own prompts', async () => {
  const { host } = await app();
  await host.keySet(KEY);
  const no = host.ask('Learn my voice from my old posts.');
  assert.equal(no.ok, false);
  assert.match(no.message, /desktop app/);
  const r = host.ask('Run my Fishbowl Studio rewrites and redos now.');
  assert.equal(r.kind, 'jobs');
  assert.match((await r.done).message, /Nothing was waiting/);
  const d = host.ask('Run the Fishbowl Studio daily run now.');
  assert.match((await d.done).message, /Finish setting up/);
});

test('API errors come back as a sentence, and the run ends', async () => {
  const home = tempHome(), appDir = tempHome();
  const events = [];
  const host = makeHost({ home, appDir, safeStorage: fakeSafeStorage(), now: () => NOW, fetchImpl, emit: (e) => events.push(e),
    createModel: () => makeModel({ create: async () => { throw new Anthropic.APIConnectionError({ message: 'offline' }); } }) });
  await host.keySet(KEY);
  await setUpBrand(host);
  const r = await host.ask('Run the Fishbowl Studio daily run now.').done;
  assert.equal(r.ok, false);
  assert.equal(events.at(-1).state, 'error');
  assert.match(events.at(-1).message, /Couldn't reach Anthropic/);
  assert.equal(host.runner.busy(host.ctx.slug), false);
});

test('autorun is off until turned on, and preferences keep only what they know', async () => {
  const { host, api } = await app();
  await host.keySet(KEY);
  await setUpBrand(host);
  assert.deepEqual(host.prefsGet(), { autorun: false });
  await host.tick();
  assert.equal(api.requests.length, 0);
  assert.deepEqual(host.prefsSet({ autorun: true, evil: 1 }), { autorun: true });
  await host.tick();
  assert.ok(api.requests.length > 0);
});

test('setup drafts in the app suggest only sites and subreddits, never searches', async () => {
  const { host, api } = await app();
  await host.keySet(KEY);
  const call = (name, args) => host.call(name, args).then((r) => r.structuredContent || JSON.parse(r.content[0].text));
  await call('studio_wizard', { action: 'create', name: 'Northwind Bicycles' });
  await call('studio_wizard', { action: 'answer', answers: { audience: 'City commuters', tone: 'Plain', topics: 'city cycling', off_limits: '' } });
  const d = await call('studio_wizard', { action: 'draft' });
  const r = host.ask(d.prompt);
  assert.equal(r.kind, 'wizard', JSON.stringify(d));
  const out = await r.done;
  assert.equal(out.ok, true, out.message);
  // The app shows this message to the person: plain counts, spoken to them.
  assert.doesNotMatch(out.message, /\(s\)|for them|their board/, out.message);
  assert.match(out.message, /Keep, edit or drop/, out.message);
  const task = api.requests[0].messages[0].content.at(-1).text;
  assert.match(task, /subreddits/);
  assert.doesNotMatch(task, /search/i);
  assert.deepEqual(api.requests[0].output_config.format.schema.properties.sources.items.properties.kind.enum, ['site', 'reddit']);
  const kinds = host.ctx.tx((db) => db.proposals.filter((p) => p.kind === 'source').map((p) => p.target.kind));
  assert.deepEqual(kinds.sort(), ['reddit', 'site']);
});

test('a run turns patterns in their edits into playbook proposals, without a model call', async () => {
  const { host, api } = await app();
  await host.keySet(KEY);
  await setUpBrand(host);
  const pairs = [
    ['Ever wondered about lanes? Kerbs work.', 'Kerbs work.'],
    ['Is your chain squeaking? A drop of oil fixes most squeaks.', 'A drop of oil fixes most squeaks.'],
    ['Ready for winter? Studded tyres sell early this year.', 'Studded tyres sell early this year.'],
    ['What makes a lane? A kerb does.', 'A kerb makes a lane.'],
  ];
  host.ctx.tx((db) => { db.edits = pairs.map(([before, after], i) => ({ id: i + 1, draft_id: i + 1, before, after, at: new Date(NOW - 3600e3 * 24 * (i + 1)).toISOString(), diff: editDiff(before, after) })); });
  host.prefsSet({ autorun: true });
  host.ctx.tx((db) => { db.runs.last_fetch = new Date(NOW - 3600e3).toISOString(); });
  assert.equal((await host.tick()).calls, 0);
  assert.equal(api.requests.length, 0);
  const p = host.ctx.tx((db) => db.proposals.find((x) => x.key === 'edits:cut_opening_question'));
  assert.equal(p?.status, 'open');
});
