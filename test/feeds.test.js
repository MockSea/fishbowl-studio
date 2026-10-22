import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFeed, decodeEntities, stripHtml, fetchText } from '../server/lib/feeds.js';
import { rss } from './helpers.js';

const atom = fs.readFileSync(new URL('./fixtures/atom.xml', import.meta.url), 'utf8');

test('parses RSS 2.0 items', () => {
  const xml = rss([{ title: 'One &amp; two', link: 'https://example.com/a?utm_source=x', desc: '&lt;p&gt;Hello &lt;b&gt;there&lt;/b&gt;&lt;/p&gt;', date: 'Tue, 20 Oct 2026 08:00:00 GMT' }]);
  const f = parseFeed(xml);
  assert.equal(f.title, 'Example Feed');
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].title, 'One & two');
  assert.equal(f.items[0].summary, 'Hello there');
  assert.equal(f.items[0].published, '2026-10-20T08:00:00.000Z');
});

test('parses Atom: alternate link, html titles, CDATA, drops http and untitled', () => {
  const f = parseFeed(atom);
  assert.deepEqual(f.items.map((i) => i.title), ['Cargo bikes & the school run', 'CDATA title works']);
  assert.equal(f.items[0].url, 'https://example.org/2026/cargo-bikes');
  assert.equal(f.items[0].author, 'A. Writer');
  assert.equal(f.items[0].summary, 'Parents are switching to cargo bikes.');
  assert.equal(f.items[1].summary, 'Body with link');
});

test('refuses DTDs and entity declarations', () => {
  assert.throws(() => parseFeed('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><rss><channel></channel></rss>'), /DTD/);
});

test('rejects non-feeds', () => {
  assert.throws(() => parseFeed('<html><body>hi</body></html>'), /not an RSS/);
});

test('respects the per-feed limit and summary cap', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ title: `T${i}`, link: `https://example.com/${i}`, desc: 'x'.repeat(2000) }));
  const f = parseFeed(rss(items), { limit: 5 });
  assert.equal(f.items.length, 5);
  assert.ok(f.items[0].summary.length <= 600);
});

test('unwraps aggregator links to the original article', () => {
  const xml = rss([{ title: 'Story', link: 'https://agg.example.com/rss/123', desc: '&lt;a href="https://news.example.org/2026/story"&gt;Story&lt;/a&gt;' }]);
  assert.equal(parseFeed(xml, { aggregatorHosts: ['agg.example.com'] }).items[0].url, 'https://news.example.org/2026/story');
  assert.equal(parseFeed(xml).items[0].url, 'https://agg.example.com/rss/123');
});

test('tolerates RSS 1.0 / RDF and namespaced items', () => {
  const xml = '<rdf:RDF><channel><title>R</title></channel><item><title>Rdf item</title><link>https://example.com/r</link><dc:date>2026-10-01</dc:date></item></rdf:RDF>';
  const f = parseFeed(xml);
  assert.equal(f.items[0].title, 'Rdf item');
});

test('entity decoding and html stripping', () => {
  assert.equal(decodeEntities('&#8217;&#x2014;&hellip;&unknown;'), '’—…&unknown;');
  assert.equal(stripHtml('<p>a<script>bad()</script> b<br>c</p>'), 'a b c');
});

test('fetchText enforces the byte cap and status', async () => {
  const big = { ok: true, status: 200, url: 'https://e.com', headers: new Map([['content-length', String(5e6)]]), text: async () => '' };
  big.headers.get = (k) => (k === 'content-length' ? String(5e6) : null);
  await assert.rejects(fetchText('https://e.com', { fetchImpl: async () => big }), /too large/);
  await assert.rejects(fetchText('https://e.com', { fetchImpl: async () => ({ ok: false, status: 500, headers: new Map() }) }), /HTTP 500/);
});
