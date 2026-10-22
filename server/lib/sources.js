// Board edits to sources and topics, and "draft from a link". Every write goes through the same
// validators studio_config uses (config.js), and every fetch through the same safe path the
// feeds use (feeds.js: HTTPS only, public hosts, hand-followed redirects, byte cap). Text read
// from a page is untrusted exactly like a feed item: flattened, cleaned and fenced in briefs.
import { loadSources, loadBeat, validateConfig, SLUG_RE } from './config.js';
import { fetchText, parseFeed, stripHtml, decodeEntities, MAX_PARSE_CHARS } from './feeds.js';
import { safeHttpsUrl, normaliseUrl, hostOf } from './urls.js';
import { cleanField, instructionPhrase } from './fence.js';
import { oneLine } from './text.js';
import { mergeItems } from './dedupe.js';

const LISTS = ['feeds', 'reading'];
const field = (s, cap) => cleanField(oneLine(s), cap);

function saveSources(ctx, src) {
  const v = validateConfig('sources.json', src);
  ctx.store.writeFile('sources.json', JSON.stringify(v, null, 2) + '\n');
  return v;
}

function saveBeat(ctx, beat) {
  const v = validateConfig('beat.json', beat);
  ctx.store.writeFile('beat.json', JSON.stringify(v, null, 2) + '\n');
  return v;
}

const listOf = (list) => {
  if (!LISTS.includes(list || 'feeds')) throw new Error('list must be feeds or reading');
  return list || 'feeds';
};

// A display name for a source: hers if given, else the feed's own title, else the host. Feed
// titles are outside text, so they are flattened, capped, and dropped if instruction-shaped.
export function sourceName(given, feedTitle, url) {
  for (const n of [given, feedTitle]) {
    const s = field(n || '', 80);
    if (s && !instructionPhrase(s)) return s;
  }
  return hostOf(url) || 'News source';
}

// The first RSS/Atom alternate link in an HTML page, resolved against the page URL.
export function feedLinkIn(html, base) {
  const head = String(html).slice(0, 200_000);
  for (const m of head.matchAll(/<link\b[^<>]{0,1000}>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?alternate/i.test(tag) || !/type\s*=\s*["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!href) continue;
    try { return new URL(decodeEntities(href[1]), base).toString(); } catch { continue; }
  }
  return null;
}

// Fetch a URL she pasted as a source. A feed is used as is; a web page is searched for its feed.
async function probeFeed(ctx, url) {
  const body = await fetchText(url, { fetchImpl: ctx.fetchImpl });
  try { return { url, parsed: parseFeed(body, { limit: 3 }) }; }
  catch (e) {
    if (/DTD/.test(e.message)) throw e;
    const alt = feedLinkIn(body, url);
    if (!alt) throw new Error("that page isn't a news feed and doesn't link to one. Try the site's RSS or Atom link.");
    const safe = safeHttpsUrl(alt);
    if (!safe.ok) throw new Error(`the page points to a feed that ${safe.reason}`);
    return { url: safe.url, parsed: parseFeed(await fetchText(safe.url, { fetchImpl: ctx.fetchImpl }), { limit: 3 }) };
  }
}

export async function addSource(ctx, { url, list, name, topic }) {
  const l = listOf(list);
  const safe = safeHttpsUrl(url);
  if (!safe.ok) throw new Error(`That address ${safe.reason}.`);
  if (topic && !SLUG_RE.test(topic)) throw new Error('topic must be one of your topic slugs');
  const before = loadSources(ctx.store);
  const known = (u) => before[l].some((f) => normaliseUrl(f.url) === normaliseUrl(u));
  if (known(safe.url)) throw new Error('That source is already on the list.');
  let probe;
  try { probe = await probeFeed(ctx, safe.url); }
  catch (e) { throw new Error(`Couldn't add it: ${e.message}`); }
  if (known(probe.url)) throw new Error('That source is already on the list.');
  const beat = loadBeat(ctx.store);
  const src = loadSources(ctx.store);
  const entry = { name: sourceName(name, probe.parsed.title, probe.url), url: probe.url, topic: topic && beat.topics.includes(topic) ? topic : 'other' };
  src[l] = [...src[l], entry];
  saveSources(ctx, src);
  ctx.store.event('source:add', { list: l, host: hostOf(probe.url) }, ctx.now());
  return { ok: true, message: `Added ${entry.name}${probe.parsed.items.length ? ` (${probe.parsed.items.length}+ recent stories)` : ''}.`, source: entry, list: l };
}

function findSource(src, l, url) {
  const key = normaliseUrl(url);
  const i = src[l].findIndex((f) => normaliseUrl(f.url) === key);
  if (i < 0) throw new Error('No such source on the list.');
  return i;
}

export function editSource(ctx, { action, url, list, topic }) {
  const l = listOf(list);
  const src = loadSources(ctx.store);
  const i = findSource(src, l, url);
  const f = src[l][i];
  let message;
  if (action === 'pause') { f.paused = true; message = `Paused ${f.name}. It won't be read until you turn it back on.`; }
  else if (action === 'resume') { delete f.paused; message = `${f.name} is back on.`; }
  else if (action === 'remove') { src[l].splice(i, 1); message = `Removed ${f.name}.`; }
  else if (action === 'topic') {
    const beat = loadBeat(ctx.store);
    if (topic !== 'other' && !beat.topics.includes(topic)) throw new Error('Pick one of your topics.');
    f.topic = topic; message = `${f.name} now counts as ${topic}.`;
  } else throw new Error('action must be add, pause, resume, remove or topic');
  saveSources(ctx, src);
  return { ok: true, message };
}

// ---- topics ----

export function topicSlug(name) {
  return String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40).replace(/-+$/, '');
}

export function editTopic(ctx, { action, topic, weight }) {
  const beat = loadBeat(ctx.store);
  const slug = topicSlug(topic);
  if (!slug || !SLUG_RE.test(slug)) throw new Error('A topic is a word or two, like "urban cycling".');
  if (slug === 'other') throw new Error('"other" is always there for stories that fit nowhere else.');
  let message;
  if (action === 'add') {
    if (beat.topics.includes(slug)) throw new Error('That topic is already on the list.');
    beat.topics = [...beat.topics, slug];
    message = `Added the topic ${slug.replace(/-/g, ' ')}.`;
  } else if (action === 'remove') {
    if (!beat.topics.includes(slug)) throw new Error('No such topic.');
    beat.topics = beat.topics.filter((t) => t !== slug);
    delete beat.weights?.[slug];
    delete beat.curiosity?.[slug];
    // Sources filed under it move to "other" so they keep being read.
    const src = loadSources(ctx.store);
    let moved = 0;
    for (const l of LISTS) for (const f of src[l]) if (f.topic === slug) { f.topic = 'other'; moved++; }
    if (moved) saveSources(ctx, src);
    message = `Removed ${slug.replace(/-/g, ' ')}.${moved ? ` ${moved} source(s) filed under it now count as other.` : ''}`;
  } else if (action === 'weight') {
    if (!beat.topics.includes(slug)) throw new Error('No such topic.');
    if (![1, 2, 3].includes(weight)) throw new Error('weight must be 1 (less), 2 (normal) or 3 (more)');
    beat.weights = { ...(beat.weights || {}), [slug]: weight };
    message = `${slug.replace(/-/g, ' ')}: ${['', 'less of this', 'normal', 'more of this'][weight]}.`;
  } else throw new Error('action must be add, remove or weight');
  saveBeat(ctx, beat);
  return { ok: true, message, topic: slug };
}

// ---- draft from a link ----

const metaContent = (html, key) => {
  const re = new RegExp(`<meta\\b[^<>]{0,600}(?:name|property)\\s*=\\s*["']${key}["'][^<>]{0,600}>`, 'i');
  const tag = html.match(re)?.[0];
  const c = tag && tag.match(/content\s*=\s*["']([^"']*)["']/i);
  return c ? decodeEntities(c[1]) : '';
};

// The inside of the first <name>…</name>, or null. Two indexOf scans, so linear whatever the page.
function inner(src, lower, name, from = 0) {
  let i = lower.indexOf(`<${name}`, from);
  while (i >= 0 && !/[\s>/]/.test(lower[i + name.length + 1] || '')) i = lower.indexOf(`<${name}`, i + 1);
  if (i < 0) return null;
  const open = lower.indexOf('>', i);
  const close = open < 0 ? -1 : lower.indexOf(`</${name}>`, open);
  return close < 0 ? null : { text: src.slice(open + 1, close), after: close + name.length + 3 };
}

// One article page -> {title, summary, body}, all single-line, cleaned and capped. The page is
// untrusted: scripts, styles and tags go, entities are decoded once, control and invisible
// characters go, and fence tags are neutralised (cleanField). Every scan is linear.
export function parsePage(html) {
  const src = String(html ?? '').slice(0, MAX_PARSE_CHARS);
  const lower = src.toLowerCase();
  if (/<(rss|feed|rdf:rdf)\b/.test(lower.slice(0, 2000))) throw new Error("that's a news feed, not an article. Add it under Sources instead.");
  const titleTag = inner(src, lower, 'title')?.text.slice(0, 600) || '';
  const title = field(decodeEntities(stripHtml(metaContent(src, 'og:title') || titleTag)), 300);
  const summary = field(decodeEntities(stripHtml(metaContent(src, 'og:description') || metaContent(src, 'description'))), 600);
  const scope = inner(src, lower, 'article') || inner(src, lower, 'main');
  const art = scope ? scope.text : src.slice(Math.max(0, lower.indexOf('<body')));
  const artLower = art.toLowerCase();
  const paras = [];
  for (let at = 0, n = 0; n < 400; n++) {
    const p = inner(art, artLower, 'p', at);
    if (!p) break;
    at = p.after;
    const t = oneLine(decodeEntities(stripHtml(p.text)));
    if (t.length > 40) paras.push(t);
    if (paras.join(' ').length > 3000) break;
  }
  const body = field(paras.length ? paras.join(' ') : decodeEntities(stripHtml(art)), 3000);
  if (!title) throw new Error("couldn't find a headline on that page.");
  return { title, summary, body };
}

export async function draftLink(ctx, { url }) {
  const safe = safeHttpsUrl(url);
  if (!safe.ok) return { ok: false, message: `That link ${safe.reason}.` };
  const key = normaliseUrl(safe.url);
  const existing = ctx.tx((db) => db.items.find((i) => normaliseUrl(i.url) === key));
  let page = null;
  if (!existing) {
    try { page = parsePage(await fetchText(safe.url, { fetchImpl: ctx.fetchImpl })); }
    catch (e) { return { ok: false, message: `Couldn't read that page: ${e.message}` }; }
  }
  const now = ctx.now();
  return ctx.tx((db) => {
    let item = db.items.find((i) => normaliseUrl(i.url) === key);
    if (!item) {
      const host = hostOf(safe.url);
      mergeItems(db.items, [{ source: `link:${host}`, source_name: host, topic_hint: 'other', from_link: true, title: page.title, url: safe.url, body: [page.summary, page.body].filter(Boolean).join(' — ').slice(0, 3000), published: null, author: null }], { now, nextId: () => ctx.id('item') });
      item = db.items.find((i) => normaliseUrl(i.url) === key);
      // She chose it, so it skips triage; the job below drafts it.
      Object.assign(item, { triaged_at: new Date(now).toISOString(), note: null, interest: null, topic: 'other' });
      delete item.duplicate_of;
    }
    if (db.jobs.some((j) => j.kind === 'draft_item' && j.item_id === item.id && j.status === 'queued')) return { ok: true, message: 'That link is already queued.', item_id: item.id, title: item.title };
    db.jobs.push({ id: ctx.id('job'), kind: 'draft_item', item_id: item.id, status: 'queued', created_at: new Date(now).toISOString(), from_link: true });
    ctx.store.event('draft_link', { host: hostOf(safe.url), item_id: item.id }, now);
    return { ok: true, needs_claude: true, item_id: item.id, title: item.title, message: `Queued "${item.title}". Claude drafts it on the next run, or ask now: "do my studio rewrites".` };
  });
}
