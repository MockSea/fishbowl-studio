import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseTitle, titleSimilarity, sameStory, mergeItems } from '../server/lib/dedupe.js';
import { normaliseUrl } from '../server/lib/urls.js';

test('title normalisation drops outlet suffixes and punctuation', () => {
  assert.equal(normaliseTitle('City Opens New Bike Lanes - The Daily Example'), 'city opens new bike lanes');
  assert.equal(normaliseTitle('“Quoted” headline: here | Outlet'), 'quoted headline here');
});

test('URL normalisation strips tracking, fragments, www and trailing slash', () => {
  assert.equal(normaliseUrl('https://www.example.com/a/?utm_source=x&id=2#top'), 'https://example.com/a?id=2');
});

test('same story from two outlets clusters; different stories do not', () => {
  assert.ok(sameStory({ title: 'City council approves riverside bike lane plan' }, { title: 'Riverside bike lane plan approved by city council - Other Outlet' }));
  assert.ok(!sameStory({ title: 'City council approves riverside bike lane plan' }, { title: 'New e-bike battery standard published' }));
  assert.ok(titleSimilarity('a b c', 'x y z') === 0);
});

test('mergeItems dedupes by URL and clusters stories', () => {
  const existing = [];
  let id = 0;
  const now = Date.parse('2026-10-21T10:00:00Z');
  const fresh = [
    { source: 'rss:a', title: 'City council approves riverside bike lane plan', url: 'https://a.example.com/1' },
    { source: 'rss:a', title: 'Duplicate url', url: 'https://a.example.com/1?utm_medium=feed' },
    { source: 'rss:b', title: 'Riverside bike lane plan approved by city council', url: 'https://b.example.com/9' },
    { source: 'rss:b', title: 'Something else entirely about tyres', url: 'https://b.example.com/10' },
  ];
  const r = mergeItems(existing, fresh, { now, nextId: () => ++id });
  assert.deepEqual(r, { added: 3, dupes: 1, clustered: 1 });
  assert.equal(existing[1].duplicate_of, existing[0].id);
  assert.deepEqual(existing[0].also, ['rss:b']);
  assert.equal(existing[2].story, existing[2].id);
});
