// Triage: a cheap first pass. One private line plus a 0-10 interest per item, so only
// items worth it get drafted. Reactions show on the Reads view and feed the taste log.
import { loadBeat, loadPositions, loadAudience, topicsOf, topicWeight } from './config.js';
import { createFencer, SETTINGS_NOTE } from './fence.js';
import { clip, clamp } from './text.js';
import { TRIAGE } from './prompts.js';
import { killReasons, reasonsLine } from './learn.js';
import { discover } from './social.js';
import { byId } from './state.js';

// Where a story came from, when it isn't a news feed, so a post or a search result is read as one.
const WEB_KIND = { watch: 'a social post', trends: 'a trending topic on X', search: 'a web search result', reddit: 'a Reddit post' };

export function triageCandidates(items, batch = 40) {
  return items
    .filter((i) => !i.explore && !i.duplicate_of && !i.triaged_at)
    .sort((a, b) => Date.parse(b.published || b.fetched_at) - Date.parse(a.published || a.fetched_at))
    .slice(0, batch);
}

export function positionsBlock(store, fz, n = 6) {
  const ps = loadPositions(store).slice().sort((a, b) => b.strength - a.strength).slice(0, n);
  return fz.block('The brand\'s positions (theirs; hold them)', ps.map((p) => ({ position: p.text, strength: `${p.strength}/5` })), SETTINGS_NOTE);
}

export function audienceBlock(store, fz) {
  const a = loadAudience(store);
  const rows = [...a.who.map((w) => ({ who: w.text, confidence: `${w.confidence}/5` })), ...a.buttons.map((b) => ({ button: b.text, confidence: `${b.confidence}/5` }))];
  return fz.block('Who the brand writes for, and its buttons', rows, 'Lean toward a button when the item touches one.');
}

// Their topic weights, said plainly. The slugs passed the config validator, so they are safe to list.
function weightNote(beat) {
  const more = beat.topics.filter((t) => topicWeight(beat, t) === 3), less = beat.topics.filter((t) => topicWeight(beat, t) === 1);
  return [more.length ? `\nThey want more about: ${more.join(', ')}.` : '', less.length ? `\nThey want less about: ${less.join(', ')}.` : ''].join('');
}

export function triageQueue(ctx) {
  const settings = ctx.settings();
  const beat = loadBeat(ctx.store);
  return ctx.tx((db) => {
    const items = triageCandidates(db.items, settings.triage_batch);
    if (!items.length) return { done: true, text: 'Nothing new to triage.' };
    const q = { id: ctx.id('queue'), item_ids: items.map((i) => i.id), at: ctx.iso() };
    db.queues = [...db.queues.slice(-20), q];
    const fz = createFencer();
    const rows = items.map((i, n) => ({ item: n + 1, source: i.source_name, kind: WEB_KIND[i.web], title: i.title, summary: clip(i.body, 400), also_covered_by: (i.also || []).length || undefined }));
    const text = [
      `# Triage (${items.length} items)`, TRIAGE({ offLimits: beat.off_limits, onBeat: beat.on_beat }), fz.guard,
      `## Topics (use exactly one of these)\n${topicsOf(beat).join(', ')}${weightNote(beat)}`,
      reasonsLine(killReasons(db.drafts, byId(db.items), ctx.now())),
      positionsBlock(ctx.store, fz), audienceBlock(ctx.store, fz),
      fz.block('Items', rows),
      `Reply with studio_record_triage({queue_id: ${q.id}, reactions: [{item, thought, interest, topic}, ...]}).`,
    ].filter(Boolean).join('\n\n');
    return { done: false, queue_id: q.id, count: items.length, text };
  });
}

export function recordTriage(ctx, { queue_id, reactions = [] }) {
  const settings = ctx.settings();
  const topics = new Set(topicsOf(loadBeat(ctx.store)));
  return ctx.tx((db) => {
    const q = db.queues.find((x) => x.id === queue_id);
    if (!q) throw new Error(`Unknown queue ${queue_id}; call studio_triage_queue first.`);
    let saved = 0, worth = 0;
    const at = ctx.iso();
    for (const r of reactions) {
      const item = db.items.find((i) => i.id === q.item_ids[(r.item | 0) - 1]);
      if (!item || item.triaged_at) continue;
      item.note = clip(String(r.thought || '').trim(), 200);
      item.interest = clamp(Math.round(Number(r.interest) || 0), 0, 10);
      item.topic = topics.has(r.topic) ? r.topic : 'other';
      item.triaged_at = at;
      db.attention.push({ item_id: item.id, topic: item.topic, interest: item.interest, decision: 'skipped', source: item.source, at });
      saved++;
      if (item.interest >= settings.interest_threshold) worth++;
    }
    // Sites that keep turning up in good search results become suggestions for them, never sources.
    const suggested = discover(ctx, db);
    return { saved, worth_drafting: worth, threshold: settings.interest_threshold, suggested: suggested.length };
  });
}
