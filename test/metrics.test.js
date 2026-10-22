import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, mapColumns, metricsTool } from '../server/lib/metrics.js';
import { testContext } from './helpers.js';

test('CSV parsing handles quotes, commas, semicolons and BOM', () => {
  assert.deepEqual(parseCsv('﻿a,b\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(parseCsv('a;b\r\n1;2'), [['a', 'b'], ['1', '2']]);
});

test('analytics column names map to fields', () => {
  const c = mapColumns(['Post URL', 'Impressions', 'Reactions', 'Comments', 'Reposts']);
  assert.deepEqual(c, { views: 1, likes: 2, replies: 3, reposts: 4, url: 0 });
  assert.deepEqual(mapColumns(['Post URL', 'Post text', 'Impressions']), { views: 2, url: 0, text: 1 });
});

test('CSV import matches posted drafts by link or text and sets outcomes', () => {
  const { ctx } = testContext();
  ctx.tx((db) => { db.drafts = [
    { id: 1, status: 'posted', platform: 'linkedin', text: 'Repair cafes are the best kind of community infrastructure.', post_url: 'https://social.example.com/p/1', posted_at: '2026-10-20T08:00:00Z' },
    { id: 2, status: 'posted', platform: 'x', text: 'Four km of lanes and the bridge is suddenly a commute.', posted_at: '2026-10-20T08:00:00Z' },
    { id: 3, status: 'passed', text: 'not posted' },
  ]; });
  const csv = 'Post URL,Post text,Impressions,Reactions,Comments,Reposts\nhttps://social.example.com/p/1/?utm_source=x,,"1,200",30,4,2\n,Four km of lanes and the bridge is suddenly a commute.,500,10,1,0\nhttps://other.example.com/9,,1,1,1,1\n';
  const r = metricsTool(ctx, { action: 'import_csv', csv });
  assert.equal(r.matched, 2);
  assert.deepEqual(r.unmatched_rows, [4]);
  const d = ctx.store.read('drafts', []);
  assert.equal(d[0].metrics.views, 1200);
  assert.equal(d[0].outcome, 30 + 2 * 2 + 4);
  assert.throws(() => metricsTool(ctx, { action: 'add', draft_id: 3, likes: 1 }), /posted first/);
});
