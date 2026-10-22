// Their verdicts and actions on the board (or in chat). Pass and edit carry a fingerprint of the
// text they saw; if a rewrite landed while the board was open, the write is refused.
import { sha12, cleanPost, clip, oneLine } from './text.js';
import { safeHttpsUrl } from './urls.js';
import { editDiff, KILL_REASONS, KILL_REASON_KEYS } from './learn.js';
import { postingOn } from './accounts.js';

export const fingerprint = (d) => sha12(d.final_text || d.text);
const LIVE = new Set(['pending', 'passed', 'edited', 'killed']);

class Refusal extends Error {}
const refuse = (msg) => { throw new Refusal(msg); };

export function act(ctx, args) {
  const settings = ctx.settings();
  const iso = ctx.iso();
  try {
    return ctx.tx((db) => {
      const fn = ACTIONS[args.action];
      if (!fn) refuse(`Unknown action "${args.action}". Use one of: ${Object.keys(ACTIONS).join(', ')}.`);
      const res = fn(db, args, { ctx, settings, iso });
      ctx.store.event(`act:${args.action}`, { id: args.id ?? args.set_id ?? args.item_id ?? null });
      return { ok: true, ...res };
    });
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, refused: true, message: e.message };
    throw e;
  }
}

function draftOf(db, id) {
  const d = db.drafts.find((x) => x.id === Number(id));
  if (!d) refuse(`No draft ${id}.`);
  return d;
}

function checkHash(d, hash, required) {
  if (!hash && !required) return;
  if (!hash) refuse('This action needs the fingerprint (hash) of the text you saw. Refresh and try again.');
  if (hash !== fingerprint(d)) refuse(`Refused: draft ${d.id} changed since you looked at it (a rewrite landed). Here is the current text, so you can decide again:\n${d.final_text || d.text}`);
}

function pickTake(db, d, iso) {
  if (d.status !== 'option') return;
  for (const s of db.drafts.filter((x) => x.set_id === d.set_id && x.status === 'option' && x.id !== d.id)) Object.assign(s, { status: 'unpicked', decided_at: iso });
  Object.assign(d, { status: 'pending', picked_at: iso });
}

function setReason(ds, reason, note) {
  if (reason !== 'clear' && !KILL_REASONS[reason]) refuse(`Reason must be one of: ${KILL_REASON_KEYS.join(', ')}.`);
  for (const d of ds) {
    if (reason === 'clear') { delete d.kill_reason; delete d.kill_note; continue; }
    d.kill_reason = reason;
    if (note) d.kill_note = clip(oneLine(note), 300); else delete d.kill_note;
  }
}

// Their version against the draft's, kept with what changed, for the weekly pass. One record per
// draft (the latest edit wins); undoing the edit removes it.
function recordEdit(db, d, ctx, iso) {
  const i = db.edits.findIndex((e) => e.draft_id === d.id);
  if (!d.final_text) { if (i >= 0) db.edits.splice(i, 1); return; }
  const row = { id: i >= 0 ? db.edits[i].id : ctx.id('edit'), draft_id: d.id, before: d.text, after: d.final_text, platform: d.platform, topic: d.tags?.topic || 'other', shape_ids: d.tags?.shape_ids || [], at: iso, diff: editDiff(d.text, d.final_text) };
  if (i >= 0) db.edits[i] = row; else db.edits.push(row);
  if (db.edits.length > 300) db.edits.splice(0, db.edits.length - 300);
}

// Approving here (chat or board) never schedules a post: only the board's Approve for an account
// with "Post for me" on does (studio_post_schedule). Say so when it matters.
const noPostNote = (db, d) => (postingOn(db.accounts.find((a) => a.type === d.platform))
  ? ' It won\'t be posted for you: only Approve on the board counts as their OK to post. They can tap "Post it for me" on the board, or copy it.' : '');

function setDrafts(db, setId) {
  const ds = db.drafts.filter((x) => x.set_id === Number(setId));
  if (!ds.length) refuse(`No set ${setId}.`);
  return ds;
}

const ACTIONS = {
  pick(db, { id, hash }, { iso }) {
    const d = draftOf(db, id);
    if (d.status !== 'option') refuse(`Draft ${id} isn't waiting to be picked (it's ${d.status}).`);
    checkHash(d, hash, false);
    pickTake(db, d, iso);
    return { message: `Picked take ${d.take_n}. It's now waiting for pass, edit or kill.`, id: d.id };
  },

  pass(db, { id, hash }, { iso }) {
    const d = draftOf(db, id);
    if (!['pending', 'option'].includes(d.status)) refuse(`Draft ${id} can't be passed from ${d.status}.`);
    checkHash(d, hash, true);
    pickTake(db, d, iso);
    Object.assign(d, { status: d.final_text ? 'edited' : 'passed', decided_at: iso, verdict_fp: fingerprint(d) });
    return { message: `Passed. Copy it from the Passed tab (${d.platform}, ${(d.final_text || d.text).length} characters).${noPostNote(db, d)}`, id: d.id };
  },

  edit(db, { id, hash, text, and_pass }, { ctx, iso }) {
    const d = draftOf(db, id);
    if (!['pending', 'option'].includes(d.status)) refuse(`Draft ${id} can't be edited from ${d.status}.`);
    checkHash(d, hash, true);
    const t = cleanPost(text);
    const max = ctx.platforms()[d.platform]?.max_chars || 3000;
    if (!t) refuse('The edit is empty.');
    if (t.length > max) refuse(`Too long for ${d.platform}: ${t.length} of ${max} characters.`);
    if (/^\s*(https?:\/\/\S+\s*)+$/.test(t)) refuse('An edit can\'t be only a link.');
    pickTake(db, d, iso);
    d.final_text = t === d.text ? null : t;
    recordEdit(db, d, ctx, iso);
    if (and_pass) Object.assign(d, { status: d.final_text ? 'edited' : 'passed', decided_at: iso, verdict_fp: fingerprint(d) });
    return { message: and_pass ? `Saved your edit and passed it.${noPostNote(db, d)}` : 'Saved your edit. Pass it when you\'re happy.', id: d.id, hash: fingerprint(d) };
  },

  kill(db, { id, reason }, { iso }) {
    const d = draftOf(db, id);
    if (!['pending', 'passed', 'edited'].includes(d.status)) refuse(`Draft ${id} can't be killed from ${d.status}${d.status === 'option' ? ' (use "none of these" for a set)' : ''}.`);
    Object.assign(d, { status: 'killed', decided_at: iso, killed_from: d.status });
    if (reason) setReason([d], reason);
    return { message: 'Killed. It will count against its shape.', id: d.id, ask_reason: !reason };
  },

  // One tap after a skip: why. Optional; a skip without a reason teaches the same as before.
  kill_reason(db, { id, set_id, reason, note }) {
    const ds = set_id != null ? setDrafts(db, set_id).filter((x) => x.status === 'passed_over') : [draftOf(db, id)];
    if (!ds.length || ds.some((d) => !['killed', 'passed_over'].includes(d.status))) refuse('Only a skipped draft can have a reason.');
    setReason(ds, reason, note);
    return { message: reason === 'clear' ? 'Reason cleared.' : `Noted: ${KILL_REASONS[reason].toLowerCase()}.`, id: ds[0].id, reason };
  },

  none(db, { set_id, note, reason }, { ctx, iso }) {
    const ds = setDrafts(db, set_id).filter((x) => x.status === 'option');
    if (!ds.length) refuse(`Set ${set_id} has no takes waiting.`);
    for (const d of ds) Object.assign(d, { status: 'passed_over', decided_at: iso });
    if (reason) setReason(ds, reason);
    if (note) db.feedback.push({ id: ctx.id('feedback'), set_id: Number(set_id), text: clip(note, 1000), prior_text: ds.map((d) => d.text).join('\n---\n'), at: iso, on_set: true, rewrite: 'n/a' });
    return { message: 'Passed over all takes. Ask for a redo if the story deserves another go.', set_id: Number(set_id), ask_reason: !reason };
  },

  redo(db, { set_id, note }, { ctx, settings, iso }) {
    const ds = setDrafts(db, set_id);
    if (ds.some((d) => d.status === 'option')) ACTIONS.none(db, { set_id, note }, { ctx, iso });
    const itemId = ds[0].item_id;
    const done = db.jobs.filter((j) => j.kind === 'redo' && j.item_id === itemId).length;
    if (done >= settings.max_redos) refuse(`This story has already been redone ${done} times (the limit is ${settings.max_redos}).`);
    if (db.jobs.some((j) => j.kind === 'redo' && j.set_id === Number(set_id))) refuse('A redo for this set is already queued.');
    const lastNote = note || db.feedback.filter((f) => f.set_id === Number(set_id)).pop()?.text || null;
    const job = { id: ctx.id('job'), kind: 'redo', set_id: Number(set_id), item_id: itemId, note: lastNote ? clip(lastNote, 1000) : null, status: 'queued', created_at: iso };
    db.jobs.push(job);
    return { message: 'Redo queued. Claude writes new takes on its next run, or ask Claude now: "do my studio rewrites".', job_id: job.id, needs_claude: true };
  },

  restore(db, { id, reason }, { ctx, iso }) {
    const d = draftOf(db, id);
    if (d.status !== 'killed') refuse(`Only killed drafts can be restored (this one is ${d.status}).`);
    const r = String(reason || '').trim();
    if (!r) refuse('Restoring needs a reason: what did you see in it the second time?');
    db.reversals.push({ id: ctx.id('reversal'), draft_id: d.id, reason: clip(r, 500), line: d.final_text || d.text, at: iso });
    Object.assign(d, { status: 'pending', decided_at: null, restored_at: iso, restore_trail: [...(d.restore_trail || []), { reason: clip(r, 500), at: iso }] });
    delete d.kill_reason; delete d.kill_note;
    return { message: 'Restored. Your reason will reach the drafter.', id: d.id };
  },

  resurrect(db, { id }, { iso }) {
    const d = draftOf(db, id);
    if (d.status !== 'scrapped') refuse(`Only scrapped drafts can be resurrected (this one is ${d.status}).`);
    Object.assign(d, { status: 'pending', resurrected_at: iso, orig_set_id: d.set_id, set_id: null, released_at: iso });
    return { message: 'Resurrected. It doesn\'t count against today\'s cap, and the ranker learns it missed one.', id: d.id };
  },

  heart(db, { target = 'draft', id, note }, { ctx, iso }) {
    const ref = Number(id);
    const existing = db.hearts.findIndex((h) => h.target === target && h.ref === ref);
    if (existing >= 0) { db.hearts.splice(existing, 1); return { message: 'Heart removed.', hearted: false }; }
    let snapshot;
    if (target === 'read') snapshot = db.items.find((i) => i.id === ref)?.note;
    else { const d = draftOf(db, ref); snapshot = target === 'thinking' ? d.thinking : d.final_text || d.text; }
    if (!snapshot) refuse('Nothing to heart there.');
    db.hearts.push({ id: ctx.id('heart'), target, ref, note: note ? clip(note, 280) : null, snapshot, at: iso });
    return { message: 'Hearted.', hearted: true };
  },

  note(db, { id, text }, { ctx, settings, iso }) {
    const d = draftOf(db, id);
    const t = clip(String(text || '').trim(), 1000);
    if (!t) refuse('The note is empty.');
    const fb = { id: ctx.id('feedback'), draft_id: d.id, text: t, prior_text: d.final_text || d.text, at: iso, rewrite: 'skipped' };
    db.feedback.push(fb);
    if (d.status === 'posted') return { message: 'Note saved. Posted drafts are never rewritten.' };
    if (!LIVE.has(d.status)) return { message: 'Note saved.' };
    const queued = db.jobs.filter((j) => j.kind === 'rewrite' && j.status === 'queued');
    if (queued.some((j) => j.draft_id === d.id)) return { message: 'Note saved. A rewrite for this draft is already queued; it will read this note too.' };
    if (queued.length >= settings.rewrite_queue_cap) return { message: `Note saved, but ${queued.length} rewrites are already waiting (the limit is ${settings.rewrite_queue_cap}). Ask Claude to run them, then try again.` };
    db.jobs.push({ id: ctx.id('job'), kind: 'rewrite', draft_id: d.id, feedback_id: fb.id, status: 'queued', created_at: iso });
    fb.rewrite = 'queued';
    d.rewriting = true;
    return { message: 'Note saved and a rewrite is queued. Ask Claude "do my studio rewrites", or it happens on the next run.', needs_claude: true };
  },

  draft_this(db, { id, item_id }, { ctx, iso }) {
    if (item_id != null) {
      const it = db.items.find((i) => i.id === Number(item_id));
      if (!it) refuse(`No item ${item_id}.`);
      if (db.jobs.some((j) => j.kind === 'draft_item' && j.item_id === it.id && j.status === 'queued')) refuse('Already queued.');
      db.jobs.push({ id: ctx.id('job'), kind: 'draft_item', item_id: it.id, status: 'queued', created_at: iso });
      return { message: 'Queued. Claude drafts it on the next run, or ask now: "do my studio rewrites".', needs_claude: true };
    }
    const d = draftOf(db, id);
    if (!d.thinking) refuse('That draft has no thinking to draft from.');
    if (db.jobs.some((j) => j.kind === 'draft_thought' && j.draft_id === d.id && j.status === 'queued')) refuse('Already queued.');
    db.jobs.push({ id: ctx.id('job'), kind: 'draft_thought', draft_id: d.id, item_id: d.item_id, status: 'queued', created_at: iso });
    return { message: 'Queued a draft from this thinking.', needs_claude: true };
  },

  mark_posted(db, { id, url }, { iso }) {
    const d = draftOf(db, id);
    if (!['passed', 'edited'].includes(d.status)) refuse('Only passed drafts can be marked as posted.');
    let postUrl = null;
    if (url) { const s = safeHttpsUrl(url); if (!s.ok) refuse(`That link ${s.reason}.`); postUrl = s.url; }
    Object.assign(d, { status: 'posted', posted_at: iso, post_url: postUrl, posted_from: d.status });
    return { message: 'Marked as posted. Add its numbers later and the studio learns from them.', id: d.id };
  },

  unpost(db, { id }) {
    const d = draftOf(db, id);
    if (d.status !== 'posted') refuse('That draft isn\'t marked as posted.');
    Object.assign(d, { status: d.posted_from || 'passed', posted_at: null, post_url: null });
    return { message: 'Unmarked.', id: d.id };
  },
};

export const ACTION_NAMES = Object.keys(ACTIONS);
