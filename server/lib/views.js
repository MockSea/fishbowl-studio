// Board data: the Drafts tabs, Reads, Playbook and Settings views, as small structured
// payloads for the board plus a readable text version for chat (the fallback review).
import { fingerprint } from './act.js';
import { counterLine } from './daily.js';
import { counterText } from './run.js';
import { loadPlaybook, loadPositions, loadAudience, loadShapes, loadSources, loadBeat, loadVoice, topicWeight, allPlatforms, parseJson } from './config.js';
import { shapeVotes, resultsMultipliers, shapeWeight } from './shapes.js';
import { labelled, features, DEFAULT_WEIGHTS, SIGNALS } from './rank.js';
import { FETCH_PRESETS, scheduleTasks, nextFetchAt } from './schedule.js';
import { hostOf } from './urls.js';
import { cleanField } from './fence.js';
import { oneLine } from './text.js';

// Item text in board data is cleaned again on the way out, so items stored before the
// parser cleaned titles can't carry line breaks or invisible characters into a view.
const itemLine = (s, cap = 500) => (s == null ? s : cleanField(oneLine(s), cap));

export const TABS = {
  waiting: { statuses: ['option', 'pending'], chips: ['all', 'sets', 'singles', 'experiments', 'flagged', 'rewritten'] },
  passed: { statuses: ['passed', 'edited', 'posted'], chips: ['all', 'to post', 'posted'] },
  killed: { statuses: ['killed', 'passed_over', 'unpicked'], chips: ['all', 'killed', 'passed over', 'unpicked'] },
  scrapped: { statuses: ['scrapped'], chips: ['all', 'stale', 'over cap'] },
};

const CHIP = {
  sets: (u) => u.type === 'set', singles: (u) => u.type === 'draft',
  experiments: (u) => (u.takes || [u]).some((c) => c.experiment), flagged: (u) => (u.takes || [u]).some((c) => c.flags.length),
  rewritten: (u) => !!u.revised, 'to post': (u) => u.status !== 'posted', posted: (u) => u.status === 'posted',
  killed: (u) => u.status === 'killed', 'passed over': (u) => u.status === 'passed_over', unpicked: (u) => u.status === 'unpicked',
  stale: (u) => u.scrap_reason === 'stale', 'over cap': (u) => u.scrap_reason === 'over_daily_cap',
};

export function card(d, db, plats, shapeNames) {
  const item = d.item_id ? db.items.find((i) => i.id === d.item_id) : null;
  const shown = d.final_text || d.text;
  const p = plats[d.platform] || { name: d.platform, max_chars: 0 };
  return {
    id: d.id, set_id: d.set_id, take_n: d.take_n, status: d.status, kind: d.kind, origin: d.origin,
    platform: d.platform, platform_name: p.name, text: shown, original: d.final_text ? d.text : null, hash: fingerprint(d),
    chars: shown.length, max_chars: p.max_chars, thinking: d.thinking || '',
    topic: d.tags?.topic, form: d.tags?.form, shapes: (d.tags?.shape_ids || []).map((s) => shapeNames[s] || s), hybrid: !!d.tags?.hybrid,
    experiment: d.tags?.experiment || null, flags: (d.lint || []).map((f) => f.label), lint: (d.lint || []).map((f) => ({ code: f.code, label: f.label })),
    rank: d.rank ? { pos: d.rank.pos, of: d.rank.of, score: round(d.rank.score), signals: roundAll(d.rank.signals), explore: !!d.rank.explore, top: d.rank.top === d.id } : null,
    item: item ? { id: item.id, title: itemLine(item.title), url: itemLine(item.url, 2000), source: itemLine(item.source_name, 80), published: item.published, interest: item.interest } : null,
    created_at: d.created_at, released_at: d.released_at, decided_at: d.decided_at, posted_at: d.posted_at, post_url: d.post_url,
    revised: !!d.revised_at, rewriting: !!d.rewriting, notes: db.feedback.filter((f) => f.draft_id === d.id).length,
    restore_trail: d.restore_trail || [], scrap_reason: d.scrap_reason || null, resurrected: !!d.resurrected_at,
    hearted: db.hearts.some((h) => h.target === 'draft' && h.ref === d.id), thinking_hearted: db.hearts.some((h) => h.target === 'thinking' && h.ref === d.id),
    metrics: d.metrics || null, redo_queued: d.set_id ? db.jobs.some((j) => j.kind === 'redo' && j.set_id === d.set_id && j.status === 'queued') : false,
    redos_left: null,
  };
}

const round = (x) => (x == null ? null : Math.round(x * 100) / 100);
const roundAll = (o) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)])) : null);

function shapeNameMap(store) {
  return Object.fromEntries(loadShapes(store).map((s) => [s.id, s.name]));
}

export function draftsView(ctx, db, { tab = 'waiting', chip = 'all', platform = 'all', offset = 0, limit = 30 } = {}) {
  const t = TABS[tab] || TABS.waiting;
  const plats = allPlatforms();
  const names = shapeNameMap(ctx.store);
  const rows = db.drafts.filter((d) => t.statuses.includes(d.status) && (platform === 'all' || d.platform === platform));
  const units = [];
  const sets = new Map();
  for (const d of rows) {
    const c = card(d, db, plats, names);
    if (d.status === 'option' && d.set_id) {
      if (!sets.has(d.set_id)) { const u = { type: 'set', set_id: d.set_id, status: 'option', takes: [], item: c.item, rank: c.rank, platform: c.platform, platform_name: c.platform_name, released_at: c.released_at }; sets.set(d.set_id, u); units.push(u); }
      sets.get(d.set_id).takes.push(c);
    } else units.push({ type: 'draft', ...c });
  }
  for (const u of sets.values()) {
    u.takes.sort((a, b) => a.take_n - b.take_n);
    const top = u.takes.find((c) => c.rank?.top);
    u.rank = top?.rank || u.rank;
    u.our_pick = top?.id ?? null;
    u.redo_queued = u.takes[0].redo_queued;
  }
  const when = (u) => Date.parse(tab === 'waiting' ? u.released_at || u.created_at : u.decided_at || u.posted_at || u.released_at || u.created_at || 0) || 0;
  units.sort((a, b) => (tab === 'waiting' ? (when(b) - when(a)) || ((a.rank?.pos ?? 99) - (b.rank?.pos ?? 99)) : when(b) - when(a)));
  const filtered = chip === 'all' || !CHIP[chip] ? units : units.filter(CHIP[chip]);
  const counts = Object.fromEntries(Object.entries(TABS).map(([k, v]) => [k, new Set(db.drafts.filter((d) => v.statuses.includes(d.status)).map((d) => (d.status === 'option' ? `s${d.set_id}` : d.id))).size]));
  return { view: 'drafts', tab, chip, platform, chips: t.chips, counts, total: filtered.length, offset, units: filtered.slice(offset, offset + limit) };
}

export function readsView(ctx, db, { offset = 0, limit = 40 } = {}) {
  const drafted = new Set(db.drafts.map((d) => d.item_id));
  const queued = new Set(db.jobs.filter((j) => j.kind === 'draft_item' && j.status === 'queued').map((j) => j.item_id));
  const reads = db.items.filter((i) => i.triaged_at && !i.explore).sort((a, b) => Date.parse(b.triaged_at) - Date.parse(a.triaged_at))
    .slice(offset, offset + limit).map((i) => ({
      id: i.id, title: itemLine(i.title), url: itemLine(i.url, 2000), source: itemLine(i.source_name, 80), published: i.published, triaged_at: i.triaged_at, note: i.note, interest: i.interest, topic: i.topic,
      also: (i.also || []).length, drafted: drafted.has(i.id), queued: queued.has(i.id), hearted: db.hearts.some((h) => h.target === 'read' && h.ref === i.id),
    }));
  const wander = db.discoveries.slice(-10).reverse().map((d) => { const i = db.items.find((x) => x.id === d.item_id); return { id: d.id, finding: d.finding, question: d.question, interest: d.interest, topic: d.topic, title: itemLine(i?.title), url: itemLine(i?.url, 2000), source: itemLine(i?.source_name, 80) }; });
  return { view: 'reads', reads, wander, offset };
}

export function playbookView(ctx, db) {
  const votes = shapeVotes(db.drafts, db.hearts), mult = resultsMultipliers(db.drafts);
  const settings = ctx.settings();
  return {
    view: 'playbook',
    proposals: db.proposals.filter((p) => p.status === 'open'),
    playbook: loadPlaybook(ctx.store), positions: loadPositions(ctx.store), audience: loadAudience(ctx.store),
    shapes: loadShapes(ctx.store).map((s) => ({ id: s.id, name: s.name, mechanism: s.mechanism, platforms: s.platforms, home: !!s.home, weight: round(shapeWeight(s, votes, mult, settings.home_weight)), up: votes[s.id]?.up || 0, down: votes[s.id]?.down || 0 })),
  };
}

export function settingsView(ctx) {
  const s = ctx.settings();
  const src = loadSources(ctx.store);
  const voice = loadVoice(ctx.store);
  return {
    view: 'settings', home: ctx.store.home,
    settings: { brand: s.brand, daily_cap: s.daily_cap, release_hours: s.release_hours, held_max_hours: s.held_max_hours, takes_per_item: s.takes_per_item, posts_per_day: s.posts_per_day, evergreen_per_day: s.evergreen_per_day, overused_phrases: s.overused_phrases, platforms: s.platforms, fetch_every: s.fetch_every },
    platforms: Object.values(allPlatforms()).map((p) => ({ id: p.id, name: p.name, max_chars: p.max_chars, enabled: !!s.platforms[p.id]?.enabled })),
    feeds: src.feeds.map((f) => ({ name: f.name, url: f.url, topic: f.topic })), reading: src.reading.map((f) => ({ name: f.name, url: f.url, topic: f.topic })),
    samples: voice.samples.map((x) => ({ text: x.text, platform: x.platform })), has_voice: !!voice.text.trim(),
  };
}

const DAY = 24 * 3600e3;
const label = (slug) => String(slug || 'other').replace(/-/g, ' ');

export function sourcesView(ctx, db) {
  const src = loadSources(ctx.store);
  const beat = loadBeat(ctx.store);
  const now = ctx.now();
  const failing = new Map((db.runs.feed_errors || []).map((e) => [e.name, e.error]));
  const row = (f, list) => {
    const mine = db.items.filter((i) => i.source === `${list === 'feeds' ? 'rss' : 'explore'}:${f.name}`);
    const week = mine.filter((i) => now - Date.parse(i.fetched_at) < 7 * DAY).length;
    const last = mine.reduce((m, i) => Math.max(m, Date.parse(i.fetched_at) || 0), 0);
    const status = f.paused ? 'paused' : list === 'feeds' && failing.has(f.name) ? 'failing' : 'active';
    return { name: f.name, url: f.url, host: hostOf(f.url), topic: f.topic, list, paused: !!f.paused, status, error: status === 'failing' ? failing.get(f.name) : null, week, last_at: last ? new Date(last).toISOString() : null };
  };
  const links = db.jobs.filter((j) => j.kind === 'draft_item' && j.from_link).slice(-8).reverse().map((j) => {
    const i = db.items.find((x) => x.id === j.item_id);
    const drafted = db.drafts.some((d) => d.item_id === j.item_id);
    return { job_id: j.id, title: itemLine(i?.title), host: hostOf(i?.url), url: itemLine(i?.url, 2000), status: drafted ? 'drafted' : j.status, at: j.created_at };
  });
  return { view: 'sources', feeds: src.feeds.map((f) => row(f, 'feeds')), reading: src.reading.map((f) => row(f, 'reading')), topics: beat.topics, links, last_fetch: db.runs.last_fetch || null };
}

// Ranker features in her words. Internal ones (form, caps) are left out.
function featureLabel(f, shapeNames) {
  const [k, ...rest] = f.split(':');
  const v = rest.join(':');
  if (k === 'topic') return v === 'other' ? null : `Posts about ${label(v)}`;
  if (k === 'shape') return `"${shapeNames[v] || label(v)}" posts`;
  if (k === 'len') return { short: 'Short posts', mid: 'Medium-length posts', long: 'Longer posts' }[v];
  if (k === 'platform') return `${allPlatforms()[v]?.name || v} posts`;
  if (k === 'source') return `Stories from ${itemLine(v.replace(/^(rss|explore|link):/, ''), 80)}`;
  if (k === 'kind') return v === 'evergreen' ? 'Evergreen posts' : null;
  if (k === 'experiment') return v === 'yes' ? 'Experiments' : null;
  return { question: 'Posts that ask a question', number: 'Posts with a number in them', 'first-person': 'Posts that say "we" or "our"' }[f] || null;
}

const SIGNAL_LABEL = { hot: 'how fresh a story is', trending: 'what lots of outlets are covering', interest: 'how interesting the story is', entertaining: 'what you tend to approve' };

// What it is learning from her verdicts, and why: approvals vs skips per feature over 21 days
// (the same verdict labels and shrinkage the ranker's "entertaining" signal uses), plus how the
// rank weights moved in the last week.
export function learnedInterests(ctx, db) {
  const now = ctx.now();
  const names = shapeNameMap(ctx.store);
  const plats = allPlatforms();
  const items = new Map(db.items.map((i) => [i.id, i]));
  const verdicts = labelled(db.drafts, now).filter((x) => x.w === 0.25);
  const base = verdicts.length ? verdicts.reduce((s, x) => s + x.y, 0) / verdicts.length : 0.5;
  const tally = {};
  for (const { d, y } of verdicts) {
    for (const f of features(d, items.get(d.item_id), plats[d.platform])) {
      const t = (tally[f] ??= { yes: 0, n: 0 });
      t.n++; t.yes += y;
    }
  }
  const learned = Object.entries(tally).map(([f, t]) => ({ f, ...t, label: featureLabel(f, names) })).filter((r) => r.label && r.n >= 2).map((r) => {
    const lift = (r.yes + 4 * base) / (r.n + 4) - base;
    return { key: r.f, label: r.label, direction: lift >= 0 ? 'up' : 'down', strength: Math.min(3, Math.max(1, Math.round(Math.abs(lift) * 12))), lift: round(lift),
      why: `You approved ${r.yes} of ${r.n} in the last 3 weeks${r.n >= 3 ? ` (${Math.round((r.yes / r.n) * 100)}%, against ${Math.round(base * 100)}% overall)` : ''}.` };
  }).filter((r) => Math.abs(r.lift) >= 0.03).sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift)).slice(0, 8);
  const hearts = db.hearts.filter((h) => h.target === 'draft' && now - Date.parse(h.at) < 21 * DAY).length;
  const cur = db.weights.current, hist = db.weights.history || [];
  const weekAgo = hist.filter((h) => now - Date.parse(h.at) >= 7 * DAY).pop()?.weights || DEFAULT_WEIGHTS;
  const ranking = cur ? SIGNALS.map((k) => ({ signal: k, label: SIGNAL_LABEL[k], weight: Math.round(cur[k] * 100), change: Math.round((cur[k] - (weekAgo[k] ?? cur[k])) * 100) })) : [];
  return { learned, hearts, base: Math.round(base * 100), verdicts: verdicts.length, ranking };
}

export function topicsView(ctx, db) {
  const beat = loadBeat(ctx.store);
  const src = loadSources(ctx.store);
  const now = ctx.now();
  const recent = db.attention.filter((a) => now - Date.parse(a.at) < 14 * DAY);
  const topics = beat.topics.map((t) => {
    const seen = recent.filter((a) => a.topic === t);
    const ds = db.drafts.filter((d) => d.tags?.topic === t && now - Date.parse(d.decided_at || d.created_at) < 21 * DAY);
    return {
      slug: t, label: label(t), weight: topicWeight(beat, t),
      sources: [...src.feeds, ...src.reading].filter((f) => f.topic === t).length,
      read: seen.length, avg_interest: seen.length ? round(seen.reduce((s, a) => s + (a.interest || 0), 0) / seen.length) : null,
      approved: ds.filter((d) => ['passed', 'edited', 'posted'].includes(d.status)).length, skipped: ds.filter((d) => ['killed', 'passed_over'].includes(d.status)).length,
    };
  });
  return { view: 'topics', topics, ...learnedInterests(ctx, db) };
}

export function scheduleView(ctx, db) {
  const s = ctx.settings();
  const preset = FETCH_PRESETS[s.fetch_every] ? s.fetch_every : 'weekdays';
  return {
    view: 'schedule', fetch_every: preset, release_hours: s.release_hours, daily_cap: s.daily_cap,
    presets: Object.entries(FETCH_PRESETS).map(([key, p]) => ({ key, label: p.label, blurb: p.blurb, note: p.note || null })),
    tasks: scheduleTasks(preset, s.release_hours), last_fetch: db.runs.last_fetch || null, next_fetch: nextFetchAt(preset, db.runs.last_fetch, ctx.now()),
    home: ctx.store.home,
  };
}

// Every persona, for the switcher and the profile cards: name, whether it's set up, what waits.
export function personasSummary(ctx) {
  const active = ctx.personas.active();
  return ctx.personas.list().map((p) => {
    const store = ctx.persona(p.slug).store;
    let settings = {}, waiting = 0, feeds = 0;
    try { settings = parseJson(store.readFile('settings.json'), {}); } catch {}
    try { waiting = new Set(store.read('drafts', []).filter((d) => ['pending', 'option'].includes(d.status)).map((d) => d.set_id ?? `d${d.id}`)).size; } catch {}
    try { feeds = loadSources(store).feeds.length; } catch {}
    return { slug: p.slug, name: p.name, active: p.slug === active, setup_complete: !!settings.setup_complete, waiting, feeds };
  });
}

// The three first-run steps, done or not. Shown until there is a draft.
export function firstRun(ctx, db) {
  const steps = [
    { key: 'sources', done: loadSources(ctx.store).feeds.length > 0 },
    { key: 'topics', done: loadBeat(ctx.store).topics.length > 0 },
    { key: 'schedule', done: !!db.runs.last_fetch },
  ];
  return { show: !db.drafts.length, steps };
}

export function header(ctx, db) {
  const c = counterLine(db.drafts, db.days, ctx.settings(), ctx.now());
  const me = ctx.personas.get(ctx.slug);
  return {
    counter: c, counter_text: counterText(c), jobs: db.jobs.filter((j) => j.status === 'queued').length, proposals: db.proposals.filter((p) => p.status === 'open').length,
    brand: me.name || ctx.settings().brand, home: ctx.store.home, persona: { slug: me.slug, name: me.name }, personas: personasSummary(ctx), setup_complete: !!ctx.settings().setup_complete, first_run: firstRun(ctx, db),
  };
}

// Plain-text version for chat review: numbered, with the ids the review skill needs. Story
// titles come from feeds, so they never share a line with a [draft · hash] marker: they go in
// one fenced block at the end, keyed by the list number.
export function draftsText(v, head, fz) {
  const lines = [`${head.counter_text}${head.jobs ? ` · ${head.jobs} job(s) waiting for Claude` : ''}`, `${v.tab} (${v.total})${v.chip !== 'all' ? ` · ${v.chip}` : ''}:`];
  const stories = [];
  let n = 0;
  for (const u of v.units) {
    if (u.item) stories.push({ n: n + 1, story: u.item.title, source: u.item.source });
    if (u.type === 'set') {
      lines.push(`\n${++n}. [set ${u.set_id}] ${u.platform_name} · pick one of ${u.takes.length}${u.item ? ' · story below' : ''}`);
      for (const c of u.takes) lines.push(`   ${n}${'abc'[c.take_n - 1] || c.take_n}) [draft ${c.id} · hash ${c.hash}]${c.id === u.our_pick ? ' (our pick)' : ''} ${c.text.replace(/\n/g, '\n      ')}${c.flags.length ? `\n      ⚠ ${c.flags.join('; ')}` : ''}`);
    } else {
      lines.push(`\n${++n}. [draft ${u.id} · hash ${u.hash}] ${u.platform_name} · ${u.chars} chars · ${u.status}${u.item ? ' · story below' : u.kind === 'evergreen' ? ' · evergreen' : ''}\n   ${u.text.replace(/\n/g, '\n   ')}${u.flags.length ? `\n   ⚠ ${u.flags.join('; ')}` : ''}`);
    }
  }
  if (!v.units.length) lines.push('(nothing here)');
  if (stories.length && fz) lines.push('', fz.guard, fz.block('The stories behind these drafts (headlines from feeds; by list number)', stories));
  return lines.join('\n');
}
