// Reading: fetch every feed, dedupe by URL and by story, age out old items.
// Wander: slow curiosity reading over her approved reading list; it never drafts.
import { loadSources, loadBeat, loadPositions, topicsOf, topicWeight } from './config.js';
import { fetchText, parseFeed } from './feeds.js';
import { mergeItems } from './dedupe.js';
import { hostOf } from './urls.js';
import { createFencer, INSTRUCTION_RE, ownWords, SETTINGS_NOTE } from './fence.js';
import { clip, clamp, mean } from './text.js';
import { WANDER } from './prompts.js';
import { fetchDue } from './schedule.js';
import { feedKey } from './handles.js';

const H = 3600e3;

async function pool(tasks, n = 4) {
  const out = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); }
  }));
  return out;
}

export async function fetchAll(ctx, { force = false } = {}) {
  const sources = loadSources(ctx.store);
  const feeds = sources.feeds.filter((f) => !f.paused);
  if (!feeds.length) return { feeds: 0, added: 0, dupes: 0, clustered: 0, errors: [], note: sources.feeds.length ? 'Every feed is paused. Turn one back on under Sources.' : 'No feeds yet. Add one under Sources on the board, or run /studio:setup or /studio:add-source.' };
  if (!force) {
    const due = fetchDue(ctx.settings().fetch_every, ctx.tx((db) => db.runs.last_fetch), ctx.now());
    if (!due.fetch) return { feeds: 0, added: 0, dupes: 0, clustered: 0, errors: [], skipped: true, note: `Didn't read the news this time: ${due.reason}. Carry on with the rest of the run.` };
  }
  const results = await pool(feeds.map((f) => async () => {
    try {
      const xml = await fetchText(f.url, { fetchImpl: ctx.fetchImpl });
      return { f, parsed: parseFeed(xml, { limit: f.limit, aggregatorHosts: sources.aggregator_hosts }) };
    } catch (e) { return { f, error: e.message }; }
  }));
  const now = ctx.now();
  return ctx.tx((db) => {
    const fresh = [];
    for (const r of results) {
      if (r.error) continue;
      for (const it of r.parsed.items) fresh.push(r.f.kind === 'reddit' ? redditItem(r.f, it) : { source: feedKey(r.f), source_name: r.f.name, topic_hint: r.f.topic, title: it.title, url: it.url, body: it.summary, published: it.published, author: it.author });
    }
    const res = mergeItems(db.items, fresh, { now, nextId: () => ctx.id('item') });
    const pruned = prune(db, ctx.settings().item_keep_days, now);
    db.runs.last_fetch = new Date(now).toISOString();
    const errors = results.filter((r) => r.error).map((r) => ({ name: r.f.name, error: r.error }));
    db.runs.feed_errors = errors;
    ctx.store.event('fetch', { ...res, pruned, errors: errors.length }, now);
    return { feeds: feeds.length, paused: sources.feeds.length - feeds.length, ...res, pruned, errors };
  });
}

// A subreddit post is read like a story, minus the poster: Reddit users are private people, so
// the username and the "submitted by /u/…  [link] [comments]" footer are dropped.
export function redditItem(f, it) {
  const body = String(it.summary || '').replace(/\s*submitted by\s+\/?u\/[\w-]+[\s\S]*$/i, '').replace(/\[(link|comments)\]/gi, '').trim();
  return { source: feedKey(f), source_name: f.name, topic_hint: f.topic, title: it.title, url: it.url, body, published: it.published, author: null, web: 'reddit' };
}

function prune(db, keepDays, now) {
  const keep = new Set([...db.drafts.map((d) => d.item_id), ...db.discoveries.map((d) => d.item_id)]);
  const before = db.items.length;
  db.items = db.items.filter((i) => keep.has(i.id) || now - Date.parse(i.fetched_at) < keepDays * 24 * H);
  return before - db.items.length;
}

// ---- wander ----

export function topicScores(attention, beat, recentText, now) {
  const scores = {};
  const recent = attention.filter((a) => now - Date.parse(a.at) < 7 * 24 * H);
  for (const t of topicsOf(beat)) {
    const xs = recent.filter((a) => a.topic === t && Number.isFinite(a.interest)).map((a) => a.interest);
    const kws = beat.curiosity?.[t] || [];
    const bonus = Math.min(3, kws.filter((k) => recentText.toLowerCase().includes(String(k).toLowerCase())).length);
    scores[t] = (xs.length ? mean(xs) : 4) + bonus + topicWeight(beat, t) - 2;
  }
  return scores;
}

// Pick the next source to visit, or null. Pure: everything it needs is passed in.
export function chooseSource({ sources, visits, scores, now, wander }) {
  const dayVisits = visits.filter((v) => now - Date.parse(v.at) < 24 * H);
  if (dayVisits.length >= wander.daily_cap) return null;
  const lastFor = (pred) => Math.max(-Infinity, ...visits.filter(pred).map((v) => Date.parse(v.at)));
  const eligible = sources.filter((s) =>
    now - lastFor((v) => v.source === s.name) >= wander.source_gap_hours * H &&
    now - lastFor((v) => v.host === hostOf(s.url)) >= wander.host_gap_hours * H);
  if (!eligible.length) return null;
  const lastVisit = (s) => lastFor((v) => v.source === s.name);
  const oldest = (list) => list.slice().sort((a, b) => lastVisit(a) - lastVisit(b))[0];
  const trip = visits.length;
  if (trip % 3 === 2) return oldest(eligible);
  const visitedTopics = new Set(visits.map((v) => v.topic));
  const fresh = eligible.filter((s) => !visitedTopics.has(s.topic));
  if (fresh.length) return fresh[0];
  const topics = [...new Set(eligible.map((s) => s.topic))];
  const topicLast = (t) => lastFor((v) => v.topic === t);
  const target = trip % 3 === 1
    ? topics.sort((a, b) => topicLast(a) - topicLast(b))[0]
    : topics.sort((a, b) => (scores[b] ?? 4) - (scores[a] ?? 4) || topicLast(a) - topicLast(b))[0];
  return oldest(eligible.filter((s) => s.topic === target));
}

export async function wander(ctx) {
  const now = ctx.now();
  const settings = ctx.settings();
  const sources = loadSources(ctx.store);
  const reading = sources.reading.length ? sources.reading : sources.feeds;
  const beat = loadBeat(ctx.store);
  const pick = ctx.tx((db) => {
    const recentText = db.items.filter((i) => now - Date.parse(i.fetched_at) < 24 * H).map((i) => i.title).join(' ');
    return chooseSource({ sources: reading, visits: db.visits, scores: topicScores(db.attention, beat, recentText, now), now, wander: settings.wander });
  });
  if (!pick) return { done: true, text: 'Nothing to wander to right now (caps or gaps reached). Skip this step.' };
  let parsed, error;
  try { parsed = parseFeed(await fetchText(pick.url, { fetchImpl: ctx.fetchImpl }), { limit: 8, summaryCap: 6000, aggregatorHosts: sources.aggregator_hosts }); }
  catch (e) { error = e.message; }
  return ctx.tx((db) => {
    const visit = { id: ctx.id('visit'), source: pick.name, host: hostOf(pick.url), topic: pick.topic, at: new Date(now).toISOString(), ok: !error, error, entries: [] };
    db.visits.push(visit);
    if (error) return { done: false, visit_id: visit.id, text: `Visit to ${pick.name} failed (${error}). The slot is used; call studio_wander again or move on.` };
    const kept = parsed.items.filter((e) => !INSTRUCTION_RE.test(`${e.title} ${e.summary}`));
    const fresh = kept.map((e) => ({ source: `explore:${pick.name}`, source_name: pick.name, topic_hint: pick.topic, explore: true, title: e.title, url: e.url, body: e.summary, published: e.published, author: e.author }));
    mergeItems(db.items, fresh, { now, nextId: () => ctx.id('item') });
    const byUrl = new Map(db.items.map((i) => [i.url, i]));
    visit.entries = kept.map((e) => byUrl.get(e.url)?.id).filter(Boolean);
    const fz = createFencer();
    const entries = visit.entries.map((id, n) => { const i = db.items.find((x) => x.id === id); return { item: n + 1, title: i.title, text: i.body }; });
    const questions = db.discoveries.filter((d) => d.topic === pick.topic && d.question).slice(-3).map((d) => ({ question: d.question }));
    const positions = loadPositions(ctx.store).slice().sort((a, b) => b.strength - a.strength).slice(0, 6);
    const text = [
      `# Wander: ${pick.name} (topic: ${pick.topic})`, WANDER, fz.guard,
      fz.block('The brand\'s positions', positions.map((p) => ({ position: p.text })), SETTINGS_NOTE),
      fz.block('Open questions from earlier visits', questions),
      fz.block('What you are reading', entries),
      `Reply with studio_record_wander({visit_id: ${visit.id}, findings: [...]}) — findings may be empty.`,
    ].filter(Boolean).join('\n\n');
    return { done: false, visit_id: visit.id, entries: entries.length, text };
  });
}

export function recordWander(ctx, { visit_id, findings = [] }) {
  const now = ctx.now();
  return ctx.tx((db) => {
    const visit = db.visits.find((v) => v.id === visit_id);
    if (!visit) throw new Error(`Unknown visit ${visit_id}`);
    if (visit.recorded) return { saved: 0, note: 'Already recorded.' };
    const kept = [], rejected = [];
    for (const f of findings.slice(0, 2)) {
      const itemId = visit.entries[(f.item | 0) - 1];
      const item = db.items.find((i) => i.id === itemId);
      if (!item) { rejected.push({ item: f.item, reason: 'no such item number' }); continue; }
      const ow = ownWords(f.finding, [`${item.title} ${item.body}`]);
      if (!ow.ok) { rejected.push({ item: f.item, reason: ow.reason }); continue; }
      const row = { id: ctx.id('discovery'), item_id: itemId, topic: visit.topic, finding: clip(f.finding, 240), question: clip(f.question || '', 160), interest: clamp(f.interest | 0, 0, 10), at: new Date(now).toISOString() };
      db.discoveries.push(row);
      db.attention.push({ item_id: itemId, topic: visit.topic, interest: row.interest, decision: 'explored', source: item.source, at: row.at });
      kept.push(row.id);
    }
    visit.recorded = true;
    return { saved: kept.length, rejected };
  });
}
