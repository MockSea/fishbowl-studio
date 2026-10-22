// studio_save_takes: validate Claude's takes against the brief, run lint / variance / caps,
// and either ask for redrafts (once) or store them. The second submission is final: takes that
// are still too long or still stuck on a drop-if-stuck crutch are dropped, others keep their flags.
import { loadBeat, loadShapes, defaults } from './config.js';
import { eligible as eligibleShapes } from './shapes.js';
import { variety, recentHistory } from './briefs.js';
import { formOf, opener, crutchesIn, collapsed } from './forms.js';
import { lint, copiesExample, unknownNames } from './lint.js';
import { contentWords, cleanPost, clip, normSpace } from './text.js';

const H = 3600e3;
const SET_KINDS = new Set(['item', 'owner_item', 'draft_item', 'redo']);

function echoes(text, source) {
  const mine = new Set(contentWords(text));
  if (mine.size < 6 || !source) return false;
  const theirs = new Set(contentWords(source));
  let k = 0;
  for (const w of mine) if (theirs.has(w)) k++;
  return k / mine.size >= 0.5;
}

function sourceTextFor(db, brief, take) {
  if (brief.kind === 'evergreen') {
    return (take.cites || []).map((n) => db.items.find((i) => i.id === brief.cite_ids[(n | 0) - 1])).filter(Boolean).map((i) => `${i.title} ${i.body}`).join('\n');
  }
  const item = db.items.find((i) => i.id === brief.item_id);
  const src = db.drafts.find((d) => d.id === brief.draft_id);
  return [item && `${item.title}\n${item.body}`, src?.thinking].filter(Boolean).join('\n');
}

// Check one take. Returns {text, form, flags, redraft:[reasons], hard:[reasons], stuck:bool}.
export function checkTake(t, i, ctx) {
  const { brief, platform, over, crutches, batchForms, beat, brand, sourceText } = ctx;
  const text = cleanPost(t.text);
  const out = { text, thinking: clip(cleanPost(t.thinking || ''), 500), form: formOf(text), redraft: [], hard: [], stuck: false };
  if (!text) { out.hard.push('empty'); return out; }
  if (text.length > platform.max_chars) out.hard.push(`too long for ${platform.name}: ${text.length} of ${platform.max_chars} characters`);
  const first = i === 0;
  if (first && brief.kind !== 'rewrite') {
    const f = over.forms.find((x) => x.form === out.form);
    if (f) out.redraft.push(`lands in the overused "${f.form}" form (${f.k} of the last ${over.n}); write it another way`);
    const o = opener(text);
    const ov = over.openers.find((x) => x.opener === o);
    if (ov) out.redraft.push(`opens with "${o}", used ${ov.k} times lately; open differently`);
    if (SET_KINDS.has(brief.kind) && collapsed([...batchForms, out.form], ctx.settings.variety.collapse_share) === out.form) out.redraft.push(`most of today's first takes are "${out.form}"; use a different structure`);
  }
  const hits = crutchesIn(text, crutches).filter((c) => over.crutches.some((x) => x.name === c));
  for (const c of hits) out.redraft.push(over.crutches.find((x) => x.name === c).note);
  out.stuck = hits.some((c) => defaults('variety').drop_if_stuck.includes(c));
  const copy = copiesExample(text, brief.examples);
  if (copy) out.redraft.push(`reuses the words "${copy}" from an example; borrow the voice, never the words`);
  if (echoes(text, sourceText)) out.redraft.push('echoes the story\'s own wording; say it in the brand\'s words');
  const cited = brief.kind !== 'evergreen' || (t.cites || []).length > 0;
  const names = unknownNames(text, { sourceText: cited ? sourceText : '', allowNames: beat.allow_names, brand });
  if (names.length) out.redraft.push(`names ${names.join(', ')}, who isn't in the source; use a role, not a name, unless it's a public figure the story names`);
  if (/(^|[^\w@.])@[A-Za-z0-9_]{2,}/.test(text)) out.redraft.push('mentions an @handle; remove it');
  out.flags = lint(text, { sourceText, platform, allowNames: beat.allow_names, brand, cited });
  return out;
}

export function saveTakes(ctx, { brief_id, takes = [] }) {
  const now = ctx.now();
  const settings = ctx.settings();
  const beat = loadBeat(ctx.store);
  const plats = ctx.platforms();
  return ctx.tx((db) => {
    const brief = db.briefs.find((b) => b.id === brief_id);
    if (!brief) throw new Error(`Unknown brief ${brief_id}. Call studio_drafting_brief again.`);
    if (brief.done) throw new Error(`Brief ${brief_id} is already saved. Call studio_drafting_brief for the next one.`);
    if (takes.length !== brief.n) throw new Error(`This brief needs exactly ${brief.n} take(s); got ${takes.length}.`);
    const { over, crutches } = variety(settings, recentHistory(db.drafts, settings.variety.window));
    const batchForms = db.drafts.filter((d) => d.take_n === 1 && now - Date.parse(d.created_at) < 3 * H).map((d) => d.tags?.form);
    const checks = takes.map((t, i) => {
      const platform = plats[brief.take_platforms?.[i] || brief.platform];
      return { ...checkTake(t, i, { brief, platform, over, crutches, batchForms, beat, brand: settings.brand, sourceText: sourceTextFor(db, brief, t), settings }), raw: t, platform };
    });
    const needs = checks.map((c, i) => ({ take: i + 1, reasons: [...c.hard, ...c.redraft] })).filter((r) => r.reasons.length);
    if (brief.attempt === 0 && needs.length) {
      brief.attempt = 1;
      const swaps = needs.filter((r) => r.take === 1 && r.reasons.some((x) => /first takes|overused/.test(x)));
      if (swaps.length) reshape(brief, loadShapes(ctx.store), checks[0].form);
      return {
        status: 'redraft', brief_id,
        text: `Redraft ${needs.length === 1 ? 'take ' + needs[0].take : 'takes ' + needs.map((r) => r.take).join(', ')} and call studio_save_takes again with all ${brief.n} takes (unchanged ones as they were):\n` +
          needs.map((r) => `- take ${r.take}: ${r.reasons.join('; ')}`).join('\n') +
          (swaps.length ? `\nTake 1 now uses the shape "${brief.takes[0].shape_name}": ${brief.takes[0].mechanism}` : ''),
        requests: needs,
      };
    }
    const kept = [], dropped = [];
    checks.forEach((c, i) => {
      if (c.hard.length || c.stuck) dropped.push({ take: i + 1, reason: c.hard[0] || 'still leans on an overused crutch' });
      else kept.push({ c, i });
    });
    brief.done = true;
    const job = brief.job_id ? db.jobs.find((j) => j.id === brief.job_id) : null;
    if (job) Object.assign(job, { status: 'done', done_at: new Date(now).toISOString() });
    if (!kept.length) return { status: 'dropped', dropped, text: 'Every take was dropped. Move on to the next brief.' };
    const saved = store(ctx, db, brief, kept, now, beat);
    return {
      status: 'saved', drafts: saved.map((d) => d.id), dropped,
      flags: saved.map((d) => ({ id: d.id, flags: d.lint.map((f) => f.label) })),
      text: `Saved ${saved.length} draft(s)${dropped.length ? `, dropped ${dropped.length}` : ''}. Call studio_drafting_brief for the next piece of work.`,
    };
  });
}

function reshape(brief, shapes, badForm) {
  const used = new Set(brief.takes.flatMap((t) => t.shape_ids));
  const pool = eligibleShapes(shapes, brief.platform).filter((s) => !used.has(s.id) && s.form !== badForm);
  const s = pool[0] || shapes[0];
  Object.assign(brief.takes[0], { shape_ids: [s.id], hybrid: false, shape_name: s.name, mechanism: s.mechanism });
}

function store(ctx, db, brief, kept, now, beat) {
  const iso = new Date(now).toISOString();
  const topics = new Set([...(beat.topics || []), 'other']);
  const base = (c, i) => ({
    text: c.text, thinking: c.thinking, platform: c.platform.id, lint: c.flags,
    tags: { topic: topics.has(c.raw.topic) ? c.raw.topic : 'other', form: c.form, shape_ids: brief.takes[i]?.shape_ids || [], hybrid: !!brief.takes[i]?.hybrid, experiment: i === 0 && brief.experiment ? brief.experiment.note : null, swap: !!brief.takes[i]?.swap, explore_shape: !!brief.takes[i]?.explore },
  });
  if (brief.kind === 'rewrite') {
    const d = db.drafts.find((x) => x.id === brief.draft_id);
    const { c } = kept[0];
    d.versions = [...(d.versions || []), { text: d.final_text || d.text, at: iso }];
    Object.assign(d, { text: c.text, thinking: c.thinking || d.thinking, final_text: null, status: 'pending', lint: c.flags, revised_at: iso, rewriting: false, decided_at: null });
    d.tags = { ...d.tags, form: c.form };
    const fb = db.feedback.find((f) => f.id === db.jobs.find((j) => j.id === brief.job_id)?.feedback_id);
    if (fb) Object.assign(fb, { rewrite: 'done', new_text: c.text });
    return [d];
  }
  const out = [];
  if (brief.kind === 'evergreen') {
    const recent = new Set(db.drafts.filter((d) => d.kind === 'evergreen' && now - Date.parse(d.created_at) < 14 * 24 * H).map((d) => normSpace(d.text.toLowerCase())));
    for (const { c, i } of kept) {
      if (recent.has(normSpace(c.text.toLowerCase()))) continue;
      const cites = (c.raw.cites || []).map((n) => brief.cite_ids[(n | 0) - 1]).filter(Boolean);
      const d = { id: ctx.id('draft'), set_id: null, take_n: null, kind: 'evergreen', origin: 'evergreen', item_id: cites[0] ?? null, cites, status: 'held', created_at: iso, ...base(c, i) };
      db.drafts.push(d); out.push(d);
    }
    return out;
  }
  if (brief.kind === 'draft_thought') {
    const src = db.drafts.find((x) => x.id === brief.draft_id);
    const d = { id: ctx.id('draft'), set_id: null, take_n: null, kind: 'thought', origin: 'draft_thought', from_draft: brief.draft_id, item_id: src?.item_id ?? null, status: 'pending', released_at: iso, created_at: iso, ...base(kept[0].c, 0) };
    db.drafts.push(d);
    return [d];
  }
  const owner = brief.kind === 'owner_item' || brief.kind === 'draft_item';
  const redo = brief.kind === 'redo';
  const old = redo ? db.drafts.find((d) => d.set_id === brief.set_id) : null;
  const multi = kept.length > 1;
  const setId = multi ? ctx.id('set') : null;
  const status = owner || redo ? (multi ? 'option' : 'pending') : 'held';
  for (const { c, i } of kept) {
    const d = {
      id: ctx.id('draft'), set_id: setId, take_n: i + 1, kind: 'item', origin: brief.kind, item_id: brief.item_id, status, created_at: iso, ...base(c, i),
      ...(owner || redo ? { released_at: iso, slot_day: redo ? old?.slot_day : null, rank: redo ? old?.rank : null, redo_of: redo ? brief.set_id : null } : {}),
    };
    db.drafts.push(d); out.push(d);
  }
  const att = db.attention.slice().reverse().find((a) => a.item_id === brief.item_id);
  if (att) att.decision = 'drafted';
  if (redo) for (const d of db.drafts.filter((x) => x.set_id === brief.set_id)) d.redone = true;
  return out;
}
