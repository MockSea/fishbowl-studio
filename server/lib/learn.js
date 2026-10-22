// The flywheel: what her edits, skip reasons, hearts and verdicts say, as small pure functions.
// Nothing here writes her voice or playbook. Edit patterns become proposals she accepts on the
// board; source records and learned interests only nudge which stories are drafted first, and
// every nudge carries the sentence that explains it.
import { words, contentWords, clamp, oneLine } from './text.js';

const DAY = 24 * 3600e3;
const PASSED = new Set(['passed', 'edited', 'posted']);
const SKIPPED = new Set(['killed', 'passed_over']);

// ---- skip reasons ----

// One tap after a skip. Optional, never required.
export const KILL_REASONS = {
  off_brand: 'Off-brand', wrong_topic: 'Wrong topic', too_salesy: 'Too salesy',
  boring: 'Boring', factually_off: 'Factually off', other: 'Other',
};
export const KILL_REASON_KEYS = Object.keys(KILL_REASONS);

// Skips with a reason in the last `days`: [{reason, topic, shape, source, at}], one per set.
export function killReasons(drafts, items, now, days = 30) {
  const seen = new Set(), out = [];
  for (const d of drafts) {
    if (!d.kill_reason || !SKIPPED.has(d.status)) continue;
    const at = Date.parse(d.decided_at || d.created_at);
    if (!(now - at < days * DAY)) continue;
    const key = d.set_id ?? `d${d.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ reason: d.kill_reason, topic: d.tags?.topic || 'other', shape: (d.tags?.shape_ids || [])[0] || null, source: items.get(d.item_id)?.source || null, at: d.decided_at });
  }
  return out;
}

// {reason: {n, topics: {slug: n}}}
export function tallyReasons(rows) {
  const t = {};
  for (const r of rows) {
    const x = (t[r.reason] ??= { n: 0, topics: {} });
    x.n++; x.topics[r.topic] = (x.topics[r.topic] || 0) + 1;
  }
  return t;
}

// One plain line for the triage queue. Reason keys and topic slugs are validated, so it is safe
// outside a fence.
export function reasonsLine(rows) {
  const t = tallyReasons(rows);
  const parts = KILL_REASON_KEYS.filter((k) => t[k]).map((k) => {
    const tops = Object.entries(t[k].topics).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, n]) => `${s} ${n}`).join(', ');
    return `${KILL_REASONS[k].toLowerCase()} ${t[k].n} (${tops})`;
  });
  return parts.length ? `Why she skipped posts lately (last 30 days): ${parts.join('; ')}.` : '';
}

// ---- edits ----

const sentences = (t) => String(t || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const norm = (s) => words(s).join(' ');
const EMOJI = /\p{Extended_Pictographic}/u;
const FIRST = /\b(we|our|us)\b/i;

// What changed between the draft and her version. `keys` are the patterns the weekly pass counts;
// `removed` are short phrases she took out (candidates for "phrases we overuse").
export function editDiff(before, after) {
  const b = String(before || ''), a = String(after || '');
  const bs = sentences(b), as = sentences(a);
  const wb = words(b).length, wa = words(a).length;
  const keys = [];
  const inAfter = (s) => norm(a).includes(norm(s));
  if (bs[0] && /\?\s*$/.test(bs[0]) && !(as[0] && /\?\s*$/.test(as[0]))) keys.push('cut_opening_question');
  else if (/\?/.test(b) && !/\?/.test(a)) keys.push('cut_question');
  if (bs.length > 1 && !inAfter(bs[bs.length - 1]) && wa < wb) keys.push('cut_closing_line');
  if (wb >= 8 && wa <= wb * 0.8) keys.push('shortened');
  if (wb >= 5 && wa >= wb * 1.25) keys.push('lengthened');
  if (/!/.test(b) && !/!/.test(a)) keys.push('cut_exclamation');
  if (/(^|\s)#\w/.test(b) && !/(^|\s)#\w/.test(a)) keys.push('cut_hashtags');
  if (EMOJI.test(b) && !EMOJI.test(a)) keys.push('cut_emoji');
  if (FIRST.test(b) && !FIRST.test(a)) keys.push('cut_we');
  if (!FIRST.test(b) && FIRST.test(a)) keys.push('added_we');
  const nb = new Set(b.match(/\d[\d,.]*/g) || []);
  if ((a.match(/\d[\d,.]*/g) || []).some((n) => !nb.has(n))) keys.push('added_number');
  return { keys, removed: removedPhrases(b, a), words_before: wb, words_after: wa };
}

// Words and two- or three-word phrases in `before` that are gone from `after`. A single word
// counts only if it's a longer content word ("game-changer", "honestly"); a phrase needs one.
export function removedPhrases(before, after, max = 40) {
  const grams = (t) => {
    const w = words(t), out = new Set();
    for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
    return out;
  };
  const kept = grams(after);
  return [...grams(before)].filter((g) => !kept.has(g) && (g.includes(' ') ? contentWords(g).length >= 1 : g.length >= 5 && contentWords(g).length === 1)).slice(0, max);
}

// Each pattern: what she did (why) and the playbook line it would become (a description of the
// brand, never an order, so it passes the same check every playbook line does).
export const EDIT_PATTERNS = {
  cut_opening_question: { did: 'cut the opening question', line: 'Open with a plain statement, not a question' },
  cut_question: { did: 'took the question out', line: 'Posts make a point rather than ask the reader something' },
  cut_closing_line: { did: 'cut the last line', line: 'End on the point itself, with no summing-up last line' },
  shortened: { did: 'cut the post by a fifth or more', line: 'Tighter than a first draft: fewer words, same point' },
  lengthened: { did: 'added to the post', line: 'Room for one more concrete detail' },
  cut_exclamation: { did: 'took out the exclamation marks', line: 'No exclamation marks' },
  cut_hashtags: { did: 'took out the hashtags', line: 'No hashtags' },
  cut_emoji: { did: 'took out the emojis', line: 'No emojis' },
  cut_we: { did: 'took out "we" and "our"', line: 'About the subject, not about the brand: little "we" and "our"' },
  added_we: { did: 'added "we" or "our"', line: 'Speaks as the brand, with "we" and "our" where it is natural' },
  added_number: { did: 'added a number', line: 'One concrete number when the story has one' },
};

// Patterns across her recent edits: a pattern counts when it shows up in at least 3 edits and at
// least half of them (and there are 4 or more edits to go on).
export function editPatterns(edits, now, { days = 60, minEdits = 4, minHits = 3, share = 0.5 } = {}) {
  const recent = edits.filter((e) => now - Date.parse(e.at) < days * DAY);
  const n = recent.length;
  if (n < minEdits) return { n, patterns: [], phrases: [] };
  const count = {};
  for (const e of recent) for (const k of e.diff?.keys || []) count[k] = (count[k] || 0) + 1;
  const patterns = Object.entries(count).filter(([k, c]) => EDIT_PATTERNS[k] && c >= minHits && c / n >= share)
    .sort((a, b) => b[1] - a[1])
    .map(([key, k]) => ({ key, k, n, line: EDIT_PATTERNS[key].line, why: `You ${EDIT_PATTERNS[key].did} in ${k} of your last ${n} edits.` }));
  // A phrase counts when she cut it at least 3 times and in at least 3 of every 4 drafts that had it.
  const ph = {};
  for (const e of recent) for (const p of new Set(e.diff?.removed || [])) ph[p] = (ph[p] || 0) + 1;
  const cands = Object.entries(ph).filter(([p, c]) => c >= minHits && !/\d/.test(p)).map(([phrase, k]) => {
    const had = recent.filter((e) => ` ${norm(e.before)} `.includes(` ${phrase} `)).length;
    return { phrase, k, had };
  }).filter((x) => x.k / Math.max(x.had, 1) >= 0.75);
  // The shortest phrase that explains the pattern: "game-changer", not "a total game-changer".
  const phrases = cands.filter((x) => !cands.some((y) => y !== x && y.phrase.length < x.phrase.length && ` ${x.phrase} `.includes(` ${y.phrase} `) && y.k >= x.k))
    .sort((a, b) => b.k - a.k).slice(0, 5)
    .map(({ phrase, k, had }) => ({ phrase, k, n: had, why: `You cut "${phrase}" from ${k} of the ${had} drafts that had it.` }));
  return { n, patterns, phrases };
}

// ---- sources ----

const unitKey = (d) => d.set_id ?? `d${d.id}`;

// Per source: drafts approved of drafts decided (a set counts once) over `days`.
export function sourceRecords(drafts, items, now, days = 42) {
  const units = new Map();
  for (const d of drafts) {
    if (!d.item_id) continue;
    const at = Date.parse(d.decided_at || 0);
    if (!(now - at < days * DAY)) continue;
    const src = items.get(d.item_id)?.source;
    if (!src) continue;
    const u = units.get(unitKey(d)) || { src, yes: false, no: false, at };
    if (PASSED.has(d.status) || d.resurrected_at) u.yes = true;
    else if (SKIPPED.has(d.status)) u.no = true;
    u.at = Math.max(u.at, at);
    units.set(unitKey(d), u);
  }
  const rec = {};
  for (const u of units.values()) {
    if (!u.yes && !u.no) continue;
    const r = (rec[u.src] ??= { approved: 0, decided: 0, last_approved: null });
    r.decided++;
    if (u.yes) { r.approved++; r.last_approved = Math.max(r.last_approved || 0, u.at); }
  }
  for (const r of Object.values(rec)) {
    r.why = `${r.approved} of ${r.decided} draft${r.decided === 1 ? '' : 's'} from it approved in the last ${Math.round(days / 7)} weeks.`;
    // Keeps losing: suggest pausing it (never paused automatically).
    r.suggest_pause = (r.decided >= 5 && r.approved / r.decided <= 0.2) || (r.decided >= 4 && r.approved === 0);
  }
  return rec;
}

// ---- learned interests that move item ranking ----

// Approve-vs-skip lift per topic, shrunk toward the overall rate. Counted per draft over 21 days,
// exactly as the Topics page's "learned from your verdicts" counts, so the two never disagree.
function verdictLift(drafts, items, now, days = 21) {
  const all = [];
  for (const d of drafts) {
    const at = Date.parse(d.decided_at || d.released_at || d.created_at);
    if (!(at >= now - days * DAY)) continue;
    const y = PASSED.has(d.status) || d.resurrected_at ? 1 : SKIPPED.has(d.status) ? 0 : null;
    if (y != null) all.push({ y, topic: d.tags?.topic || 'other' });
  }
  const base = all.length ? all.reduce((s, u) => s + u.y, 0) / all.length : 0.5;
  const tally = (key) => {
    const t = {};
    for (const u of all) if (u[key]) { const x = (t[u[key]] ??= { yes: 0, n: 0 }); x.n++; x.yes += u.y; }
    for (const x of Object.values(t)) x.lift = (x.yes + 4 * base) / (x.n + 4) - base;
    return t;
  };
  return { base, topic: tally('topic') };
}

// Each part is capped, each kind at +-1, and a story's total at +-1.5.
const MAX_TOPIC = 0.75, MAX_SOURCE = 0.75, MAX_TOTAL = 1.5;
const label = (s) => String(s || 'other').replace(/-/g, ' ');

// Adjustments, in interest points, for each topic and source, each with the sentences that
// explain it. A story's boost is its topic's plus its source's, capped at +-1.5 (her own topic
// weights move a story by one point, for scale).
export function interestBoosts({ drafts = [], items = [], hearts = [], now, sourceNames = {} }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const lift = verdictLift(drafts, byId, now);
  const rec = sourceRecords(drafts, byId, now);
  const reasons = killReasons(drafts, byId, now);
  const out = { topic: {}, source: {} };
  const add = (kind, key, pts, why) => { const r = (out[kind][key] ??= { points: 0, why: [] }); r.points += pts; r.why.push(why); };
  for (const [t, x] of Object.entries(lift.topic)) {
    if (x.n < 2 || t === 'other' || Math.abs(x.lift) < 0.03) continue;
    add('topic', t, clamp(x.lift * 4, -MAX_TOPIC, MAX_TOPIC), `You approved ${x.yes} of ${x.n} posts about ${label(t)} in the last 3 weeks.`);
  }
  const wrong = {};
  for (const r of reasons) if (r.reason === 'wrong_topic') wrong[r.topic] = (wrong[r.topic] || 0) + 1;
  for (const [t, k] of Object.entries(wrong)) add('topic', t, -Math.min(0.5, 0.25 * k), `You skipped ${k} ${label(t)} post${k > 1 ? 's' : ''} as "wrong topic".`);
  const hearted = hearts.filter((h) => h.target === 'read' && now - Date.parse(h.at) < 30 * DAY).map((h) => byId.get(h.ref)).filter(Boolean);
  const ht = {}, hs = {};
  for (const i of hearted) { if (i.topic && i.topic !== 'other') ht[i.topic] = (ht[i.topic] || 0) + 1; if (i.source) hs[i.source] = (hs[i.source] || 0) + 1; }
  for (const [t, k] of Object.entries(ht)) add('topic', t, Math.min(0.5, 0.25 * k), `You hearted ${k} read${k > 1 ? 's' : ''} about ${label(t)}.`);
  for (const [s, k] of Object.entries(hs)) add('source', s, Math.min(0.5, 0.25 * k), `You hearted ${k} read${k > 1 ? 's' : ''} from ${sourceNames[s] || sourceLabel(s)}.`);
  for (const [s, r] of Object.entries(rec)) {
    if (r.decided < 3) continue;
    const pts = clamp((r.approved / r.decided - lift.base) * 2, -MAX_SOURCE, MAX_SOURCE);
    if (Math.abs(pts) >= 0.1) add('source', s, pts, `${r.approved} of ${r.decided} drafts from ${sourceNames[s] || sourceLabel(s)} approved.`);
  }
  for (const kind of ['topic', 'source']) for (const r of Object.values(out[kind])) r.points = Math.round(clamp(r.points, -1, 1) * 100) / 100;
  return out;
}

export function boostFor(item, boosts) {
  if (!item || !boosts) return { points: 0, why: [] };
  const t = boosts.topic[item.topic], s = boosts.source[item.source];
  const points = clamp((t?.points || 0) + (s?.points || 0), -MAX_TOTAL, MAX_TOTAL);
  return { points: Math.round(points * 100) / 100, why: [...(t?.why || []), ...(s?.why || [])] };
}

// "rss:Example Feed" -> "Example Feed"; "x:@handle" -> "@handle" on X; "search:bike lanes" -> the search.
export function sourceLabel(key) {
  const [kind, ...rest] = String(key || '').split(':');
  const v = oneLine(rest.join(':'));
  if (kind === 'watch') { const [p, ...h] = v.split(':'); return p === 'x' ? `${h.join(':')} on X` : `${h.join(':')} on LinkedIn`; }
  if (kind === 'search') return `your search "${v}"`;
  if (kind === 'reddit') return `r/${v}`;
  if (kind === 'trends') return 'X trending topics';
  return v || 'a source';
}
