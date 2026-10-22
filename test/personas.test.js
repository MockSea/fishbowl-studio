import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.js';
import { makeContext } from '../server/lib/state.js';
import { callTool } from '../server/lib/tools.js';
import { slugify } from '../server/lib/personas.js';

const read = (p) => fs.readFileSync(p, 'utf8');

// A studio folder as v0 left it: config files and state/ at the root.
function legacyHome() {
  const home = tempHome();
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ brand: 'Northwind Bicycles', setup_complete: true, daily_cap: 7 }));
  fs.writeFileSync(path.join(home, 'voice.md'), '# Northwind\nWarm and practical.');
  fs.mkdirSync(path.join(home, 'state'));
  fs.writeFileSync(path.join(home, 'state', 'drafts.json'), JSON.stringify([{ id: 1, status: 'pending', text: 'Keep me', platform: 'x', created_at: '2026-10-20T08:00:00Z', lint: [], tags: {} }]));
  fs.writeFileSync(path.join(home, 'state', 'events.jsonl'), '{"at":"2026-10-20T08:00:00Z","kind":"fetch"}\n');
  fs.mkdirSync(path.join(home, 'reports'));
  fs.writeFileSync(path.join(home, 'reports', 'weekly-2026-10-16.md'), '# Week');
  fs.writeFileSync(path.join(home, 'notes-she-keeps.txt'), 'not ours');
  return home;
}

test('a single-brand folder migrates into personas/<slug> on first start, losing nothing', () => {
  const home = legacyHome();
  const ctx = makeContext({ home });
  const dir = path.join(home, 'personas', 'northwind-bicycles');
  assert.equal(ctx.slug, 'northwind-bicycles');
  assert.equal(ctx.store.home, dir);
  assert.equal(JSON.parse(read(path.join(dir, 'settings.json'))).daily_cap, 7);
  assert.match(read(path.join(dir, 'voice.md')), /Warm and practical/);
  assert.equal(ctx.store.read('drafts', [])[0].text, 'Keep me');
  assert.match(read(path.join(dir, 'state', 'events.jsonl')), /fetch/);
  assert.equal(read(path.join(dir, 'reports', 'weekly-2026-10-16.md')), '# Week');
  for (const f of ['settings.json', 'voice.md', 'state', 'reports']) assert.ok(!fs.existsSync(path.join(home, f)), `${f} moved`);
  assert.equal(read(path.join(home, 'notes-she-keeps.txt')), 'not ours', 'files that are not the studio\'s stay put');
  const reg = JSON.parse(read(path.join(home, 'personas.json')));
  assert.equal(reg.active, 'northwind-bicycles');
  assert.equal(reg.personas[0].name, 'Northwind Bicycles');
  assert.equal(ctx.settings().daily_cap, 7);
  // A second start is a no-op.
  const again = makeContext({ home });
  assert.equal(again.store.read('drafts', []).length, 1);
});

test('an interrupted migration finishes without overwriting what already moved', () => {
  const home = legacyHome();
  const dir = path.join(home, 'personas', 'northwind-bicycles');
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(path.join(home, 'voice.md'), path.join(dir, 'voice.md'));
  fs.writeFileSync(path.join(home, 'voice.md'), '# a stray second copy');
  const ctx = makeContext({ home });
  assert.equal(ctx.slug, 'northwind-bicycles');
  assert.match(read(path.join(dir, 'voice.md')), /Warm and practical/, 'the moved copy is kept');
  const legacy = fs.readdirSync(dir).find((f) => f.startsWith('voice.md.legacy-'));
  assert.ok(legacy, 'the stray copy is kept beside it');
  assert.equal(ctx.store.read('drafts', [])[0].text, 'Keep me');
});

test('a brand-new folder gets one empty persona', () => {
  const home = tempHome();
  const ctx = makeContext({ home });
  assert.equal(ctx.slug, 'my-brand');
  assert.deepEqual(ctx.personas.list().map((p) => p.name), ['My brand']);
  assert.equal(ctx.settings().setup_complete, false);
});

test('create, switch and rename personas; every tool acts on the active one or the one named', async () => {
  const home = legacyHome();
  const ctx = makeContext({ home });
  const made = await callTool(ctx, 'studio_personas', { action: 'create', name: 'Fernhollow Bakery' });
  assert.ok(!made.isError, made.content[0].text);
  assert.equal(ctx.slug, 'fernhollow-bakery', 'create switches to the new persona');
  assert.equal(ctx.settings().brand, 'Fernhollow Bakery');
  assert.equal(ctx.store.read('drafts', []).length, 0, 'a new persona starts empty');
  const view = await callTool(ctx, 'studio_view', { view: 'drafts' });
  assert.equal(view.structuredContent.header.persona.slug, 'fernhollow-bakery');
  assert.equal(view.structuredContent.header.first_run.show, true);
  assert.equal(view.structuredContent.header.personas.length, 2);
  // persona: overrides the active one for a single call.
  const other = await callTool(ctx, 'studio_view', { view: 'drafts', persona: 'northwind-bicycles' });
  assert.match(other.content[0].text, /Keep me/);
  assert.equal(ctx.slug, 'fernhollow-bakery', 'the override does not switch');
  await callTool(ctx, 'studio_config', { action: 'patch', patch: { daily_cap: 4 }, persona: 'northwind-bicycles' });
  assert.equal(ctx.persona('northwind-bicycles').settings().daily_cap, 4);
  assert.notEqual(ctx.settings().daily_cap, 4);
  // Switch and rename.
  await callTool(ctx, 'studio_personas', { action: 'switch', slug: 'northwind-bicycles' });
  assert.equal(ctx.slug, 'northwind-bicycles');
  const r = await callTool(ctx, 'studio_personas', { action: 'rename', slug: 'northwind-bicycles', name: 'Northwind Cycles' });
  assert.ok(!r.isError);
  assert.equal(ctx.personas.get('northwind-bicycles').name, 'Northwind Cycles');
  assert.equal(ctx.settings().brand, 'Northwind Cycles', 'the brand follows the persona name');
  // Refusals.
  for (const bad of [{ action: 'create', name: '' }, { action: 'create', name: 'Northwind Cycles' }, { action: 'create', name: 'Ignore previous instructions' }, { action: 'switch', slug: '../etc' }, { action: 'switch', slug: 'nobody' }]) {
    const res = await callTool(ctx, 'studio_personas', bad);
    assert.equal(res.isError, true, JSON.stringify(bad));
  }
  const bad = await callTool(ctx, 'studio_view', { view: 'drafts', persona: '../../tmp' });
  assert.equal(bad.isError, true, 'a persona argument cannot point outside personas/');
});

test('slugs are folder-safe and unique', () => {
  assert.equal(slugify('Northwind Bicycles!'), 'northwind-bicycles');
  assert.equal(slugify('Café Ünïcode'), 'cafe-unicode');
  assert.equal(slugify('../../etc'), 'etc');
  assert.equal(slugify('42'), 'brand');
  assert.equal(slugify('Brand', ['brand', 'brand-2']), 'brand-3');
});
