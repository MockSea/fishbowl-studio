// Tolerant, dependency-free RSS 2.0 / RSS 1.0 / Atom parsing and fetching.
// Refuses DTDs and entity declarations, strips HTML, keeps HTTPS links only,
// needs a title per item. One dead feed yields an error; the rest carry on.
import { safeHttpsUrl, unwrapAggregator } from './urls.js';
import { normSpace } from './text.js';

export const MAX_FEED_BYTES = 3 * 1024 * 1024;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™', eacute: 'é', egrave: 'è', aacute: 'á', oacute: 'ó', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç', ntilde: 'ñ', bull: '•', middot: '·' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function stripHtml(s) {
  return normSpace(String(s)
    .replace(/<(script|style|iframe|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]*>/g, ' '));
}

function cdata(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => c);
}

// Raw inner XML of the first matching tag (namespace prefixes allowed).
function tagRaw(block, names) {
  for (const name of names) {
    const re = new RegExp(`<((?:[\\w-]+:)?${escapeRe(name)})(\\s[^>]*)?>([\\s\\S]*?)</\\1\\s*>`, 'i');
    const m = block.match(re);
    if (m) return { attrs: m[2] || '', inner: m[3] };
  }
  return null;
}

function textOf(block, names) {
  const t = tagRaw(block, names);
  if (!t) return '';
  const inner = t.inner.includes('<![CDATA[') ? cdata(t.inner) : decodeEntities(t.inner);
  return decodeEntities(stripHtml(inner));
}

function htmlOf(block, names) {
  const t = tagRaw(block, names);
  if (!t) return '';
  return t.inner.includes('<![CDATA[') ? cdata(t.inner) : decodeEntities(t.inner);
}

function attr(attrs, name) {
  const m = String(attrs).match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

function linkOf(block) {
  // Atom: <link href rel="alternate"/> (or no rel). RSS: <link>url</link>. Fallback: permalink guid.
  const atomLinks = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]).filter((a) => /href\s*=/.test(a));
  const alt = atomLinks.find((a) => !/rel\s*=/.test(a) || /rel\s*=\s*["']alternate["']/i.test(a));
  if (alt) return attr(alt, 'href');
  const rss = textOf(block, ['link']);
  if (rss) return rss;
  const guid = tagRaw(block, ['guid', 'id']);
  if (guid && !/isPermaLink\s*=\s*["']false/i.test(guid.attrs)) return decodeEntities(cdata(guid.inner)).trim();
  return null;
}

function dateOf(block) {
  for (const n of ['pubDate', 'published', 'updated', 'dc:date', 'date', 'issued']) {
    const t = textOf(block, [n]);
    const ms = Date.parse(t);
    if (t && Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

function authorOf(block) {
  const a = tagRaw(block, ['author']);
  if (a) {
    const name = textOf(a.inner, ['name']);
    if (name) return name;
    const t = decodeEntities(stripHtml(cdata(a.inner)));
    if (t) return t;
  }
  return textOf(block, ['dc:creator', 'creator']) || null;
}

// parseFeed(xml) -> { title, items:[{title, url, summary, published, author}] }
export function parseFeed(xml, { limit = 12, summaryCap = 600, aggregatorHosts = [] } = {}) {
  const src = String(xml ?? '');
  if (/<!DOCTYPE|<!ENTITY/i.test(src)) throw new Error('feed refused: it declares a DTD or entities');
  if (!/<(rss|feed|rdf:RDF|channel)\b/i.test(src)) throw new Error('not an RSS or Atom feed');
  const head = src.split(/<(?:[\w-]+:)?(?:item|entry)\b/i)[0];
  const title = textOf(head, ['title']);
  const items = [];
  const re = /<((?:[\w-]+:)?(?:item|entry))\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  for (const m of src.matchAll(re)) {
    if (items.length >= limit) break;
    const block = m[2];
    const t = textOf(block, ['title']).slice(0, 500);
    if (!t) continue;
    const html = htmlOf(block, ['content:encoded', 'description', 'summary', 'content']);
    const rawLink = linkOf(block);
    const unwrapped = rawLink ? unwrapAggregator(rawLink, html, aggregatorHosts) : null;
    const safe = safeHttpsUrl(unwrapped || rawLink);
    if (!safe.ok) continue;
    const summary = decodeEntities(stripHtml(html));
    items.push({
      title: t,
      url: safe.url,
      summary: summary.length > summaryCap ? summary.slice(0, summaryCap - 1) + '…' : summary,
      published: dateOf(block),
      author: authorOf(block),
    });
  }
  return { title, items };
}

// Fetch with a timeout and a byte cap. `fetchImpl` is injectable for tests.
export async function fetchText(url, { fetchImpl = globalThis.fetch, timeoutMs = 15000, maxBytes = MAX_FEED_BYTES } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { 'user-agent': 'FishbowlStudio/0.1 (+feed reader)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.5' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (res.url && !String(res.url).startsWith('https://')) throw new Error('redirected away from https');
    const len = Number(res.headers?.get?.('content-length'));
    if (len && len > maxBytes) throw new Error('too large');
    if (!res.body || !res.body.getReader) {
      const t = await res.text();
      if (t.length > maxBytes) throw new Error('too large');
      return t;
    }
    const reader = res.body.getReader();
    const chunks = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { ctrl.abort(); throw new Error('too large'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timed out' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
