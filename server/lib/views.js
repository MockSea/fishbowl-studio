// Board data: the Drafts tabs, Reads, Playbook and Settings views, as small structured
// payloads for the board plus a readable text version for chat (the fallback review).
import { fingerprint } from './act.js';
import { counterLine } from './daily.js';
import { counterText } from './run.js';
import { loadPlaybook, loadPositions, loadAudience, loadShapes, loadSources, allPlatforms } from './config.js';
import { shapeVotes, resultsMultipliers, shapeWeight } from './shapes.js';
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
    experiment: d.tags?.experiment || null, flags: (d.lint || []).map((f) => f.label),
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
  return {
    view: 'settings', home: ctx.store.home,
    settings: { brand: s.brand, daily_cap: s.daily_cap, release_hours: s.release_hours, held_max_hours: s.held_max_hours, takes_per_item: s.takes_per_item, posts_per_day: s.posts_per_day, evergreen_per_day: s.evergreen_per_day, overused_phrases: s.overused_phrases, platforms: s.platforms },
    platforms: Object.values(allPlatforms()).map((p) => ({ id: p.id, name: p.name, max_chars: p.max_chars, enabled: !!s.platforms[p.id]?.enabled })),
    feeds: src.feeds.map((f) => ({ name: f.name, url: f.url, topic: f.topic })), reading: src.reading.map((f) => ({ name: f.name, url: f.url, topic: f.topic })),
  };
}

export function header(ctx, db) {
  const c = counterLine(db.drafts, db.days, ctx.settings(), ctx.now());
  return { counter: c, counter_text: counterText(c), jobs: db.jobs.filter((j) => j.status === 'queued').length, proposals: db.proposals.filter((p) => p.status === 'open').length, brand: ctx.settings().brand };
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
