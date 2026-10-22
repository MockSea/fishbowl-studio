// Tolerant, dependency-free RSS 2.0 / RSS 1.0 / Atom parsing and fetching.
// Refuses DTDs and entity declarations, strips HTML, keeps HTTPS links only,
// needs a title per item. One dead feed yields an error; the rest carry on.
import dns from 'node:dns/promises';
import { safeHttpsUrl, unwrapAggregator, checkAddress } from './urls.js';
import { normSpace, oneLine } from './text.js';
import { cleanField } from './fence.js';

export const MAX_FEED_BYTES = 3 * 1024 * 1024;
// Parsing stops at 1 MB and 200 items, whatever the feed sends.
export const MAX_PARSE_CHARS = 1024 * 1024;
export const MAX_ITEMS = 200;
const MAX_REDIRECTS = 5;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™', eacute: 'é', egrave: 'è', aacute: 'á', oacute: 'ó', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç', ntilde: 'ñ', bull: '•', middot: '·' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{1,10});/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function stripHtml(s) {
  return normSpace(dropElements(String(s), ['script', 'style', 'iframe', 'noscript'])
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^<>]*>/g, ' '));
}

// Remove whole elements (and everything after an unclosed one) in one linear pass.
function dropElements(s, names) {
  const open = new RegExp(`<(${names.join('|')})\\b`, 'gi');
  let out = '', pos = 0, m;
  while ((m = open.exec(s))) {
    out += s.slice(pos, m.index) + ' ';
    const end = closeTag(s, m[1], open.lastIndex);
    if (!end) return out;
    pos = open.lastIndex = end.after;
  }
  return out + s.slice(pos);
}

function cdata(s) {
  s = String(s);
  let out = '', pos = 0;
  for (;;) {
    const i = s.indexOf('<![CDATA[', pos);
    if (i < 0) return out + s.slice(pos);
    const j = s.indexOf(']]>', i + 9);
    if (j < 0) return out + s.slice(pos);
    out += s.slice(pos, i) + s.slice(i + 9, j);
    pos = j + 3;
  }
}

// Where `</name>` next closes, from `from`: {start, after}, or null. One forward scan.
function closeTag(s, name, from) {
  const re = new RegExp(`</${escapeRe(name)}\\s*>`, 'gi');
  re.lastIndex = from;
  const m = re.exec(s);
  return m ? { start: m.index, after: re.lastIndex } : null;
}

const openTagRe = (names, flags = 'i') => new RegExp(`<((?:[\\w-]+:)?(?:${names.map(escapeRe).join('|')}))(\\s[^<>]{0,2000})?>`, flags);

// Raw inner XML of the first matching tag (namespace prefixes allowed). Linear: find the open
// tag, then scan forward for its close; an unclosed tag means no match for that name.
function tagRaw(block, names) {
  for (const name of names) {
    const re = openTagRe([name], 'gi');
    const m = re.exec(block);
    if (!m) continue;
    const end = closeTag(block, m[1], re.lastIndex);
    if (end) return { attrs: m[2] || '', inner: block.slice(re.lastIndex, end.start) };
  }
  return null;
}

// Single-line item fields: no line breaks, control, format or tag characters, no fence tags.
const field = (s, cap) => cleanField(oneLine(s), cap);

function textOf(block, names) {
  const t = tagRaw(block, names);
  if (!t) return '';
  const inner = t.inner.includes('<![CDATA[') ? cdata(t.inner) : decodeEntities(t.inner);
  return oneLine(decodeEntities(stripHtml(inner)));
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
  const atomLinks = [...block.matchAll(/<link\b([^<>]{0,2000}?)\/?>/gi)].map((m) => m[1]).filter((a) => /href\s*=/.test(a));
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
// Item blocks are found by a forward scan (open tag, then its close), never a lazy regex span,
// so an unclosed <item> costs one pass rather than one pass per item.
export function parseFeed(xml, { limit = 12, summaryCap = 600, aggregatorHosts = [] } = {}) {
  const src = String(xml ?? '').slice(0, MAX_PARSE_CHARS);
  if (/<!DOCTYPE|<!ENTITY/i.test(src)) throw new Error('feed refused: it declares a DTD or entities');
  if (!/<(rss|feed|rdf:RDF|channel)\b/i.test(src)) throw new Error('not an RSS or Atom feed');
  const open = openTagRe(['item', 'entry'], 'gi');
  const first = open.exec(src);
  const title = field(textOf(first ? src.slice(0, first.index) : src, ['title']), 300);
  const items = [];
  const max = Math.min(limit, MAX_ITEMS);
  let seen = 0;
  for (let m = first; m && items.length < max && seen++ < MAX_ITEMS; m = open.exec(src)) {
    const end = closeTag(src, m[1], open.lastIndex);
    if (!end) break;
    const block = src.slice(open.lastIndex, end.start);
    open.lastIndex = end.after;
    const t = field(textOf(block, ['title']), 500);
    if (!t) continue;
    const html = htmlOf(block, ['content:encoded', 'description', 'summary', 'content']);
    const rawLink = linkOf(block);
    const unwrapped = rawLink ? unwrapAggregator(rawLink, html, aggregatorHosts) : null;
    const safe = safeHttpsUrl(unwrapped || rawLink);
    if (!safe.ok) continue;
    const summary = field(decodeEntities(stripHtml(html)), summaryCap);
    const author = authorOf(block);
    items.push({
      title: t,
      url: safe.url,
      summary,
      published: dateOf(block),
      author: author ? field(author, 200) || null : null,
    });
  }
  return { title, items };
}

// Fetch with a timeout and a byte cap. `fetchImpl` is injectable for tests. Redirects are
// followed by hand, at most 5, and every hop must pass the same host checks as a source.
// `lookup` (dns.lookup-shaped) refuses hosts that resolve to private or local addresses; it is
// on by default with the real fetch and off with an injected one unless passed.
export async function fetchText(url, { fetchImpl, timeoutMs = 15000, maxBytes = MAX_FEED_BYTES, lookup } = {}) {
  if (lookup === undefined) lookup = fetchImpl ? null : defaultLookup;
  fetchImpl ??= globalThis.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res, at = String(url);
    for (let hop = 0; ; hop++) {
      const safe = safeHttpsUrl(at);
      if (!safe.ok) throw new Error(hop ? `redirect refused: ${safe.reason}` : safe.reason);
      if (lookup) await checkAddress(safe.host, lookup);
      res = await fetchImpl(safe.url, {
        signal: ctrl.signal, redirect: 'manual',
        headers: { 'user-agent': 'FishbowlStudio/0.1 (+feed reader)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.5' },
      });
      if (!(res.status >= 300 && res.status < 400)) break;
      const loc = res.headers?.get?.('location');
      if (!loc) throw new Error(`HTTP ${res.status} without a location`);
      if (hop >= MAX_REDIRECTS) throw new Error('too many redirects');
      at = new URL(loc, safe.url).toString();
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

const defaultLookup = (host, opts) => dns.lookup(host, opts);

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
