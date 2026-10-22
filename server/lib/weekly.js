// Weekly coach. The server computes every number; Claude writes the prose and proposals.
// Part "numbers" comes first and is all the playbook proposal may lean on; their notes, taste and
// restores only arrive in part "full", after the playbook proposal is saved. Part "numbers" is
// also the periodic pass over their edits: patterns become proposals (never direct writes).
// The report (what's working, what isn't, what to try) is stored for the board's Coach page.
import { loadPlaybook, loadAudience, loadPositions, loadSources } from './config.js';
import { createFencer, SETTINGS_NOTE, instructionPhrase } from './fence.js';
import { addProposals } from './proposals.js';
import { PLAYBOOK, AUDIENCE, POSITIONS, COACH } from './prompts.js';
import { mean, localDate, oneLine, clip } from './text.js';
import { editPatterns, killReasons, tallyReasons, sourceRecords, sourceLabel, KILL_REASONS, KILL_REASON_KEYS } from './learn.js';
import { byId } from './state.js';

const DAY = 24 * 3600e3;
const PASSED = ['passed', 'edited', 'posted'];
const r2 = (x) => Math.round(x * 100) / 100;

function inWeek(d, now, field = 'created_at') { return now - Date.parse(d[field] || 0) < 7 * DAY; }

function byTag(drafts, keyOf, valOf) {
  const acc = {};
  for (const d of drafts) for (const k of [].concat(keyOf(d))) (acc[k] ??= []).push(valOf(d));
  return Object.entries(acc).map(([k, xs]) => ({ k, n: xs.length, v: mean(xs) })).sort((a, b) => b.v - a.v);
}

const table = (rows, label) => rows.length ? rows.map((r) => `- ${r.k}: ${label(r)} (n=${r.n})`).join('\n') : '- (no data yet)';

export function numbers(db, now) {
  const week = db.drafts.filter((d) => inWeek(d, now));
  const decided = db.drafts.filter((d) => d.decided_at && inWeek(d, now, 'decided_at'));
  const posted = db.drafts.filter((d) => d.status === 'posted' && inWeek(d, now, 'posted_at'));
  const measured = posted.filter((d) => d.outcome != null);
  const status = {};
  for (const d of week) status[d.status] = (status[d.status] || 0) + 1;
  const passRate = (ds) => { const v = ds.filter((d) => PASSED.includes(d.status) || ['killed', 'passed_over'].includes(d.status)); return v.length ? `${Math.round(100 * v.filter((d) => PASSED.includes(d.status)).length / v.length)}% of ${v.length}` : 'n/a'; };
  const exp = decided.filter((d) => d.tags?.experiment), base = decided.filter((d) => !d.tags?.experiment);
  const isPass = (d) => (PASSED.includes(d.status) ? 1 : 0);
  const verdictish = decided.filter((d) => PASSED.includes(d.status) || ['killed', 'passed_over'].includes(d.status));
  const top = measured.slice().sort((a, b) => b.outcome - a.outcome);
  const released = week.filter((d) => d.rank?.released);
  const scrapped = week.filter((d) => d.status === 'scrapped');
  const reasons = {};
  for (const d of scrapped) reasons[d.scrap_reason] = (reasons[d.scrap_reason] || 0) + 1;
  const rankOf = (ds) => (ds.length ? r2(mean(ds.map((d) => d.rank?.score ?? 0))) : 'n/a');
  const misses = scrapped.filter((d) => d.rank?.set_score != null).sort((a, b) => b.rank.set_score - a.rank.set_score).slice(0, 3);
  const moves = (db.weights.history || []).filter((h) => now - Date.parse(h.at) < 7 * DAY);
  const fmt = (d) => `#${d.id} [${d.platform}] ${(d.final_text || d.text).slice(0, 90).replace(/\n/g, ' ')}`;
  return [
    `## The week in numbers (to ${localDate(now)})`,
    `- drafts written: ${week.length}; by status: ${Object.entries(status).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `- posted (marked by hand): ${posted.length}; with numbers entered: ${measured.length}`,
    `- pass rate: ${passRate(decided)}; experiments ${passRate(exp)} vs baseline ${passRate(base)}`,
    `### Top 3 posts by engagement`, top.slice(0, 3).map((d) => `- ${fmt(d)} → ${d.outcome} interactions`).join('\n') || '- (no numbers yet)',
    `### Bottom 3`, top.slice(-3).reverse().map((d) => `- ${fmt(d)} → ${d.outcome}`).join('\n') || '- (no numbers yet)',
    `### Pass rate by shape`, table(byTag(verdictish, (d) => d.tags?.shape_ids || [], isPass), (r) => `${Math.round(r.v * 100)}%`),
    `### Pass rate by topic`, table(byTag(verdictish, (d) => d.tags?.topic || 'other', isPass), (r) => `${Math.round(r.v * 100)}%`),
    `### Pass rate by form`, table(byTag(verdictish, (d) => d.tags?.form || 'one-liner', isPass), (r) => `${Math.round(r.v * 100)}%`),
    `### Pass rate by platform`, table(byTag(verdictish, (d) => d.platform, isPass), (r) => `${Math.round(r.v * 100)}%`),
    `### Engagement by shape / platform / hour posted`,
    table(byTag(measured, (d) => [...(d.tags?.shape_ids || []).map((s) => `shape ${s}`), `platform ${d.platform}`, `hour ${new Date(d.posted_at).getHours()}`], (d) => d.outcome), (r) => `${r2(r.v)} avg`),
    `## The day's ten`,
    `- released: ${new Set(released.map((d) => d.set_id ?? d.id)).size} sets/posts; novelty picks: ${released.filter((d) => d.rank?.explore).length}`,
    `- scrapped: ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}; resurrected: ${week.filter((d) => d.resurrected_at).length}`,
    `- mean rank of passed: ${rankOf(released.filter((d) => PASSED.includes(d.status)))} vs not passed: ${rankOf(released.filter((d) => ['killed', 'passed_over', 'unpicked'].includes(d.status)))}`,
    `- closest misses: ${misses.map((d) => `#${d.id} (${r2(d.rank.set_score)})`).join(', ') || 'none'}`,
    `- rank weight moves: ${moves.length ? moves.map((m) => `${localDate(Date.parse(m.at))} ${Object.entries(m.weights).map(([k, v]) => `${k} ${r2(v)}`).join(' ')}${m.detail?.stalled ? ' (stalled)' : ''}`).join('; ') : 'none'}`,
    flywheel(db, now),
  ].join('\n');
}

// Their edits, skip reasons and how each source does. Source names come from feeds, so they are
// fenced by the caller (sourceRows); everything here is counts, reason keys and topic slugs.
function flywheel(db, now) {
  const items = byId(db.items);
  const reasons = tallyReasons(killReasons(db.drafts, items, now, 7));
  const ed = editPatterns(db.edits, now);
  return [
    `## Why they skipped (this week)`,
    KILL_REASON_KEYS.filter((k) => reasons[k]).map((k) => `- ${KILL_REASONS[k]}: ${reasons[k].n} (${Object.entries(reasons[k].topics).map(([t, n]) => `${t} ${n}`).join(', ')})`).join('\n') || '- (no reasons given)',
    `## Their edits (last 60 days: ${ed.n})`,
    [...ed.patterns.map((p) => `- ${p.why}`), ...ed.phrases.map((p) => `- ${p.why}`)].join('\n') || '- (no pattern yet)',
  ].join('\n');
}

export function sourceRows(db, src, now) {
  const rec = sourceRecords(db.drafts, byId(db.items), now);
  const names = Object.fromEntries([...src.feeds.map((f) => [f.kind === 'reddit' ? `reddit:${f.sub}` : `rss:${f.name}`, f.name])]);
  return Object.entries(rec).sort((a, b) => b[1].decided - a[1].decided).map(([k, r]) => ({ source: names[k] || sourceLabel(k), approved: `${r.approved} of ${r.decided}`, suggestion: r.suggest_pause ? 'keeps losing: suggest pausing it' : undefined }));
}

// The periodic pass over their edits: each pattern they show becomes one proposal, once. A pattern
// they have decided on in the last 60 days, or a line already in the playbook, is not proposed again.
export function editProposals(ctx, db, now = ctx.now()) {
  const { patterns, phrases } = editPatterns(db.edits, now);
  const recent = (key) => db.proposals.some((p) => p.key === key && (p.status === 'open' || now - Date.parse(p.decided_at || p.created_at) < 60 * DAY));
  const playbook = new Set(loadPlaybook(ctx.store).map((b) => b.toLowerCase()));
  const overused = new Set((ctx.settings().overused_phrases || []).map((x) => x.toLowerCase()));
  const list = [
    ...patterns.filter((p) => !recent(`edits:${p.key}`) && !playbook.has(p.line.toLowerCase())).map((p) => ({ kind: 'playbook', op: 'add', text: p.line, reason: p.why, refs: [`edits:${p.k}/${p.n}`], key: `edits:${p.key}` })),
    ...phrases.filter((p) => !recent(`phrase:${p.phrase}`) && !overused.has(p.phrase)).map((p) => ({ kind: 'phrase', op: 'add', text: p.phrase, reason: p.why, refs: [`edits:${p.k}/${p.n}`], key: `phrase:${p.phrase}` })),
  ];
  return addProposals(ctx, db, list, 'edits', { keyed: true });
}

export function taste(db, now) {
  const rows = db.attention.filter((a) => now - Date.parse(a.at) < 28 * DAY && a.decision !== 'explored');
  const agg = (key) => {
    const acc = {};
    for (const a of rows) { const k = a[key] || 'other'; (acc[k] ??= { seen: 0, drafted: 0 }); acc[k].seen++; if (a.decision === 'drafted') acc[k].drafted++; }
    return Object.entries(acc).sort((a, b) => b[1].seen - a[1].seen).map(([k, v]) => `- ${k}: drafted ${v.drafted} of ${v.seen}`).join('\n') || '- (nothing yet)';
  };
  return `## Taste (last 4 weeks)\n### By topic\n${agg('topic')}\n### By source\n${agg('source')}`;
}

export function weeklyBrief(ctx, { part = 'numbers' } = {}) {
  const now = ctx.now();
  return ctx.tx((db) => {
    const nums = numbers(db, now);
    const playbook = loadPlaybook(ctx.store);
    const fz = createFencer();
    const pb = playbook.length ? fz.block('Current playbook', [playbook.map((b) => `- ${b}`).join('\n')], SETTINGS_NOTE, 4000) : '## Current playbook\n(empty)';
    const sources = fz.block('How each source does (drafts approved of decided, 6 weeks)', sourceRows(db, loadSources(ctx.store), now));
    if (part === 'numbers') {
      const ep = editProposals(ctx, db, now);
      const fromEdits = db.proposals.filter((p) => p.status === 'open' && p.source === 'edits');
      return { part, edit_proposals: ep.added.length, text: [`# Weekly report, part 1: numbers`, PLAYBOOK, fz.guard, pb, nums, sources,
        fromEdits.length ? fz.block('Already proposed from their edits (don\'t repeat these)', fromEdits.map((p) => ({ kind: p.kind, op: p.op, text: p.text }))) : '',
        'Save playbook proposals with studio_save_weekly({playbook: [{op, text, old, reason}]}), then call studio_weekly_brief({part: "full"}).'].filter(Boolean).join('\n\n') };
    }
    const a = loadAudience(ctx.store);
    const ps = loadPositions(ctx.store);
    const notes = db.feedback.filter((f) => now - Date.parse(f.at) < 7 * DAY).map((f) => ({ post: f.prior_text, user_note: f.text }));
    const restores = db.reversals.filter((r) => now - Date.parse(r.at) < 7 * DAY).map((r) => ({ post: r.line, reason: r.reason }));
    const topicCounts = {};
    for (const d of db.drafts.filter((x) => now - Date.parse(x.created_at) < 7 * DAY)) topicCounts[d.tags?.topic || 'other'] = (topicCounts[d.tags?.topic || 'other'] || 0) + 1;
    const open = db.proposals.filter((p) => p.status === 'open');
    return { part, text: [`# Weekly report, part 2: the rest`, fz.guard, nums, sources, taste(db, now),
      fz.block('Proposals waiting for them', open.map((p) => ({ kind: p.kind, change: `${p.op}: ${p.text || p.old}`, why: p.reason || undefined }))),
      fz.block('Their notes this week', notes), fz.block('Kills they undid, with their reasons', restores),
      fz.block('Audience profile', [...a.who.map((w) => ({ who: w.text, confidence: `${w.confidence}/5` })), ...a.buttons.map((b) => ({ button: b.text, confidence: `${b.confidence}/5` }))], SETTINGS_NOTE) || '## Audience profile\n(empty)',
      `Evidence refs: ${Object.entries(topicCounts).map(([k, v]) => `topic:${k}=${v}`).join(', ') || 'none'}`, AUDIENCE(2),
      fz.block('Positions', ps.map((p) => ({ position: p.text, strength: `${p.strength}/5` })), SETTINGS_NOTE) || '## Positions\n(none)', POSITIONS,
      `## The coach report\n${COACH}`,
      'Finish with studio_save_weekly({summary, working: [...], not_working: [...], try: [...], audience: [...], positions: [...]}).'].filter(Boolean).join('\n\n') };
  });
}

// Coach lines are their report, shown on the board: one line each, no links or handles, nothing
// instruction-shaped. They are never fed back into a brief.
function coachLines(list, max = 4) {
  const kept = [], dropped = [];
  for (const x of (Array.isArray(list) ? list : []).slice(0, max + 2)) {
    const t = clip(oneLine(x), 240);
    if (!t || instructionPhrase(t) || /https?:\/\/|www\.|(^|\s)@\w/.test(t)) { if (t) dropped.push(t); continue; }
    if (kept.length < max) kept.push(t);
  }
  return { kept, dropped };
}

export function saveWeekly(ctx, { summary, working, not_working, try: tryNext, playbook = [], audience = [], positions = [] }) {
  const now = ctx.now();
  return ctx.tx((db) => {
    const tag = (kind) => (p) => ({ ...p, kind });
    const res = addProposals(ctx, db, [...playbook.map(tag('playbook')), ...audience.map(tag('audience')), ...positions.map(tag('position'))], 'weekly');
    const lines = { working: coachLines(working), not_working: coachLines(not_working), try: coachLines(tryNext, 3) };
    const hasCoach = summary || Object.values(lines).some((l) => l.kept.length);
    if (hasCoach) {
      const week = localDate(now);
      const prev = db.coach.find((c) => c.week === week);
      const row = { id: prev?.id ?? ctx.id('coach'), week, at: new Date(now).toISOString(), summary: summary ? clip(String(summary).trim(), 1200) : prev?.summary || null,
        working: lines.working.kept.length ? lines.working.kept : prev?.working || [], not_working: lines.not_working.kept.length ? lines.not_working.kept : prev?.not_working || [], try: lines.try.kept.length ? lines.try.kept : prev?.try || [] };
      db.coach = [...db.coach.filter((c) => c.week !== week).slice(-11), row];
    }
    const dropped = Object.values(lines).flatMap((l) => l.dropped);
    const file = `reports/weekly-${localDate(now)}.md`;
    const prior = ctx.store.readFile(file, '') || '';
    const prev = prior.match(/<!-- summary -->\n([\s\S]*?)\n<!-- \/summary -->/)?.[1] || '';
    const props = db.proposals.filter((p) => p.source === 'weekly' && now - Date.parse(p.created_at) < DAY);
    const c = db.coach.find((x) => x.week === localDate(now));
    const list = (title, xs) => (xs?.length ? `## ${title}\n${xs.map((x) => `- ${x}`).join('\n')}` : '');
    const body = [`# Weekly report ${localDate(now)}`, `<!-- summary -->\n${(summary || prev || '(summary pending)').trim()}\n<!-- /summary -->`,
      list('What\'s working', c?.working), list('What isn\'t', c?.not_working), list('Try next week', c?.try),
      numbers(db, now), taste(db, now),
      `## Proposed changes (accept or reject on the board's Coach page)\n${props.map((p) => `- ${p.kind} ${p.op}: ${p.text || p.old}${p.reason ? ` — ${p.reason}` : ''}`).join('\n') || '- none'}`].join('\n\n');
    ctx.store.writeFile(file, body + '\n');
    return { ...res, report: `${ctx.store.home}/${file}`, text: `Saved ${res.added.length} proposal(s)${res.rejected.length ? `, rejected ${res.rejected.length} (${res.rejected.map((r) => r.reason).join(' ')})` : ''}${hasCoach ? '; the coach report is on the board\'s Coach page' : ''}${dropped.length ? `; dropped ${dropped.length} coach line(s) with a link, handle or instruction` : ''}. Report: ${file}` };
  });
}
