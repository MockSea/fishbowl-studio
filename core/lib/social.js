// Reading where their audience is: watched X and LinkedIn accounts, X trending topics, and saved
// searches. The server can't read these (no open feeds, and it never logs in), so Claude does:
// studio_read_queue lists the targets they approved, with addresses the server built from validated
// handles; Claude reads each public page with its browser tool (or web search when the browser
// isn't available) and hands the posts back through studio_record_reads. They are stored as items
// and reach Claude fenced exactly like feed items. Nothing in them is ever fetched by the server,
// and no address in them becomes a source except through a proposal they accept (discovery).
import { loadSources } from './config.js';
import { fetchDue } from './schedule.js';
import { mergeItems } from './dedupe.js';
import { safeHttpsUrl, hostOf, normaliseUrl } from './urls.js';
import { cleanField } from './fence.js';
import { oneLine, sha12, localDate } from './text.js';
import { addProposals } from './proposals.js';
import { watchKey, searchKey, TRENDS_KEY, TRENDS_URL, SOCIAL_HOSTS } from './handles.js';
import { SOCIAL_READ } from './prompts.js';

const DAY = 24 * 3600e3;
export const READ_LIMITS = { watch: 10, trends: 20, search: 8 };
const STATUSES = ['read', 'no_browser', 'login_wall', 'not_found', 'failed'];
const PLATFORM_HOSTS = { x: ['x.com', 'twitter.com'], linkedin: ['linkedin.com'] };
const field = (s, cap) => cleanField(oneLine(s), cap);
const onHost = (url, hosts) => { const h = hostOf(url); return hosts.some((x) => h === x || h.endsWith(`.${x}`)); };

export function targetName(t) {
  if (t.kind === 'watch') return `${t.handle} on ${t.platform === 'x' ? 'X' : 'LinkedIn'}`;
  if (t.kind === 'trends') return 'Trending on X';
  return `Search: ${t.q}`;
}

// What Claude should read this run, or {done}. Respects their news frequency like studio_fetch.
export function readQueue(ctx, { force = false } = {}) {
  const now = ctx.now();
  const settings = ctx.settings();
  const src = loadSources(ctx.store);
  const live = (xs) => xs.filter((x) => !x.paused);
  const targets = [
    ...live(src.watch).map((w) => ({ kind: 'watch', platform: w.platform, handle: w.handle, url: w.url, key: watchKey(w), topic: w.topic, via: w.via || 'public' })),
    ...live(src.trends).map((t) => ({ kind: 'trends', platform: 'x', url: TRENDS_URL, key: TRENDS_KEY, topic: t.topic })),
    ...live(src.searches).map((s) => ({ kind: 'search', q: s.q, key: searchKey(s), topic: s.topic })),
  ].map((t, i) => ({ n: i + 1, ...t }));
  if (!targets.length) return { done: true, text: 'No watched accounts, trends or saved searches. Skip this step.' };
  return ctx.tx((db) => {
    if (!force) {
      const due = fetchDue(settings.fetch_every, db.runs.last_web_read, now);
      if (!due.fetch) return { done: true, skipped: true, text: `Didn't read accounts and searches this time: ${due.reason}. Carry on with the rest of the run.` };
    }
    const r = { id: ctx.id('web_read'), at: new Date(now).toISOString(), targets, recorded: [] };
    db.web_reads = [...db.web_reads.filter((x) => now - Date.parse(x.at) < 2 * DAY).slice(-10), r];
    // Handles, addresses and searches were validated when they added them (handles.js), so they
    // are safe to list as they are.
    const line = (t) => t.kind === 'watch' ? `${t.n}. ${t.platform === 'x' ? 'X account' : 'LinkedIn page'} ${t.handle}: open ${t.url} (logged out), up to ${READ_LIMITS.watch} recent posts`
      : t.kind === 'trends' ? `${t.n}. X trending topics: open ${t.url} (logged out), up to ${READ_LIMITS.trends} topics`
        : `${t.n}. Saved search "${t.q}": web search, up to ${READ_LIMITS.search} results from the last week`;
    return {
      done: false, read_id: r.id, count: targets.length,
      text: [`# Read accounts, trends and searches (${targets.length})`, SOCIAL_READ, `## What to read\n${targets.map(line).join('\n')}`,
        `Reply with studio_record_reads({read_id: ${r.id}, results: [{target, status, via, posts: [{text, url, posted_at, title}]}]}): one result per number.`].join('\n\n'),
    };
  });
}

function postItem(t, p, via, now) {
  const text = field(p?.text || p?.snippet || '', 1200);
  const title = field(p?.title || '', 300);
  if ((text || title).length < 3) return null;
  const safe = p?.url ? safeHttpsUrl(p.url) : { ok: false };
  let url = safe.ok ? safe.url : null;
  // A post's link must be on its own platform; a search result's can be anywhere public. Links
  // are stored for them to open, never fetched by the studio.
  if (t.kind === 'watch' && url && !onHost(url, PLATFORM_HOSTS[t.platform])) url = null;
  if (t.kind === 'trends' && url && !onHost(url, PLATFORM_HOSTS.x)) url = null;
  if (t.kind === 'search' && !url) return null;
  const posted = Date.parse(p?.posted_at);
  const head = title || (text.length > 140 ? `${text.slice(0, 140).replace(/\s+\S*$/, '')}…` : text);
  return {
    source: t.key, source_name: targetName(t), topic_hint: t.topic, title: head, url: url || t.url, dedupe_key: url ? normaliseUrl(url) : `${t.key}#${sha12(text.toLowerCase())}`,
    body: title && text !== title ? text : t.kind === 'search' ? '' : text, published: Number.isFinite(posted) && posted <= now ? new Date(posted).toISOString() : null,
    author: null, web: t.kind, via, ...(t.kind === 'search' ? { found_by: t.q } : {}),
  };
}

// Claude hands back what it read. Only targets from the queue are accepted, by number; posts are
// capped, cleaned and stored as items (fenced like any feed item wherever they reach Claude).
export function recordReads(ctx, { read_id, results = [] }) {
  const now = ctx.now();
  return ctx.tx((db) => {
    const r = db.web_reads.find((x) => x.id === read_id);
    if (!r) throw new Error(`Unknown read ${read_id}; call studio_read_queue first.`);
    const fresh = [], report = [];
    const status = { ...(db.runs.web_status || {}) };
    for (const res of (results || []).slice(0, r.targets.length)) {
      const t = r.targets[(res?.target | 0) - 1];
      if (!t) { report.push({ target: res?.target, error: 'no such target number' }); continue; }
      if (r.recorded.includes(t.n)) { report.push({ target: t.n, error: 'already recorded' }); continue; }
      r.recorded.push(t.n);
      const st = STATUSES.includes(res.status) ? res.status : 'read';
      const via = t.kind === 'search' || res.via === 'search' ? 'search' : 'browser';
      const posts = (Array.isArray(res.posts) ? res.posts : []).slice(0, READ_LIMITS[t.kind]).map((p) => postItem(t, p, via, now)).filter(Boolean);
      fresh.push(...posts);
      status[t.key] = { status: st, via, posts: posts.length, at: new Date(now).toISOString() };
      report.push({ target: t.n, kept: posts.length });
    }
    const merged = mergeItems(db.items, fresh, { now, nextId: () => ctx.id('item') });
    db.runs.web_status = status;
    db.runs.last_web_read = new Date(now).toISOString();
    const vals = Object.values(status).filter((s) => s.at === db.runs.last_web_read);
    if (vals.some((s) => s.status === 'no_browser')) db.runs.browser = { ok: false, at: db.runs.last_web_read };
    else if (vals.some((s) => s.via === 'browser' && s.status === 'read')) db.runs.browser = { ok: true, at: db.runs.last_web_read };
    ctx.store.event('web_read', { read_id, ...merged }, now);
    return { ...merged, report, text: `Saved ${merged.added} new post(s) and result(s) (${merged.dupes} already seen). They are triaged with the news.` };
  });
}

// ---- discovery ----

// Sites that keep turning up in good search results (triaged 6+), not already a source: 3 or
// more good results, from at least 2 different searches or 2 different days, in 30 days.
export function discoveryCandidates(items, src, now, { minGood = 3, minSpread = 2, days = 30 } = {}) {
  const known = new Set([...src.feeds, ...src.reading].map((f) => hostOf(f.url)));
  const by = new Map();
  for (const i of items) {
    if (i.web !== 'search' || !i.triaged_at || !(i.interest >= 6) || !(now - Date.parse(i.fetched_at) < days * DAY)) continue;
    const host = hostOf(i.url);
    if (!host || known.has(host) || SOCIAL_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) continue;
    const g = by.get(host) || { host, ids: [], queries: new Set(), days: new Set() };
    g.ids.push(i.id); g.queries.add(i.found_by); g.days.add(localDate(Date.parse(i.fetched_at)));
    by.set(host, g);
  }
  return [...by.values()].filter((g) => g.ids.length >= minGood && (g.queries.size >= minSpread || g.days.size >= minSpread))
    .map((g) => ({ host: g.host, good: g.ids.length, refs: g.ids.map((id) => `item:${id}`),
      why: `${g.ids.length} good results from ${g.queries.size > 1 ? `${g.queries.size} of your searches` : 'your search'} in the last month${g.days.size > 1 ? `, over ${g.days.size} days` : ''}.` }));
}

// Turn candidates into source proposals. A site they have already accepted or rejected is never
// proposed again. Returns the new proposal ids.
export function discover(ctx, db, now = ctx.now()) {
  const src = loadSources(ctx.store);
  const asked = new Set(db.proposals.filter((p) => p.kind === 'source').map((p) => hostOf(p.target?.url || '')));
  const fresh = discoveryCandidates(db.items, src, now).filter((c) => !asked.has(c.host));
  if (!fresh.length) return [];
  return addProposals(ctx, db, fresh.map((c) => ({ kind: 'source', op: 'add', target: { kind: 'site', url: `https://${c.host}/` }, reason: c.why, refs: c.refs })), 'discovery').added;
}
