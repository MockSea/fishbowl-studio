// Threads and Bluesky: one file each in platforms/, an account type each, shapes that suit them,
// and drafts held to their limits like any other platform.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { testContext, at } from './helpers.js';
import { allPlatforms, PLUGIN_ROOT, validateConfig, seedShapes, defaults } from '../server/lib/config.js';
import { eligible } from '../server/lib/shapes.js';
import { accountTypes } from '../server/lib/accounts.js';
import { draftingBrief } from '../server/lib/briefs.js';
import { saveTakes } from '../server/lib/save.js';

const NEW = { threads: { name: 'Threads', max: 500 }, bluesky: { name: 'Bluesky', max: 300 } };

test('Threads and Bluesky are one file each, with the same fields as the others', () => {
  const all = allPlatforms();
  const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'platforms', 'x.json'), 'utf8'))).sort();
  for (const [id, want] of Object.entries(NEW)) {
    const file = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'platforms', `${id}.json`), 'utf8'));
    assert.deepEqual(Object.keys(file).sort(), keys, `${id}.json has every field x.json has`);
    assert.equal(all[id].name, want.name);
    assert.equal(all[id].max_chars, want.max);
    assert.ok(all[id].target_chars[1] < all[id].max_chars && all[id].long_over <= all[id].max_chars);
    assert.equal(all[id].hashtags_max, 0);
    assert.ok(eligible(seedShapes(), id).length >= 10, `${id} has shapes to draft with`);
    // An account type to match, which can post once she turns it on.
    const t = accountTypes()[id];
    assert.equal(t.label, want.name);
    assert.equal(t.capabilities.post, true);
    assert.match(t.compose, /^https:\/\//);
    assert.match(t.post_warning, /restrict|take down/);
    // Off for an existing studio until she switches it on; switching it on is a valid setting.
    assert.equal(defaults('settings').platforms[id].enabled, false);
    assert.equal(validateConfig('settings.json', { platforms: { [id]: { enabled: true, share: 0.5 } } }).platforms[id].enabled, true);
  }
});

test('a Threads or Bluesky brief carries its limits, and a take over the limit is sent back', () => {
  for (const [id, want] of Object.entries(NEW)) {
    const { ctx } = testContext({ now: at(2026, 10, 22, 9, 0) });
    ctx.store.writeFile('settings.json', JSON.stringify({ brand: 'Fernhollow Bakery', setup_complete: true, takes_per_item: 1, evergreen_per_day: 0, platforms: { linkedin: { enabled: false }, x: { enabled: false }, [id]: { enabled: true, share: 1 } } }));
    ctx.store.writeFile('voice.md', '# Fernhollow\nCalm, warm, specific.\n');
    ctx.tx((db) => { db.items = [{ id: 1, source: 'rss:Example Bakers Bulletin', source_name: 'Example Bakers Bulletin', title: 'Community fridges reach twenty sites', url: 'https://news.example.org/fridges', body: 'A volunteer network now runs twenty community fridges.', published: new Date().toISOString(), fetched_at: new Date().toISOString(), story: 1, triaged_at: new Date().toISOString(), interest: 8, topic: 'other', note: 'where our day-olds go' }]; });
    const b = draftingBrief(ctx);
    assert.equal(b.platform, id);
    assert.match(b.text, new RegExp(`${want.name}`));
    assert.match(b.text, new RegExp(`${want.max}`));
    const long = 'Twenty community fridges now, and ours gets the day-olds at six. '.repeat(Math.ceil((want.max + 40) / 66));
    const r = saveTakes(ctx, { brief_id: b.brief_id, takes: [{ text: long, thinking: 'too much', topic: 'other' }] });
    assert.equal(r.status, 'redraft', `${id}: over ${want.max} characters is sent back`);
    assert.match(JSON.stringify(r), new RegExp(`too long for ${want.name}`));
    const ok = saveTakes(ctx, { brief_id: b.brief_id, takes: [{ text: 'Twenty community fridges in town. Ours gets the day-olds at six.', thinking: 'short', topic: 'other' }] });
    assert.equal(ok.status, 'saved');
    assert.equal(ctx.store.read('drafts', [])[0].platform, id);
  }
});
