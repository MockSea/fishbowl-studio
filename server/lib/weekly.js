// Weekly report. The server computes every number; Claude writes the prose and proposals.
// Part "numbers" comes first and is all the playbook proposal may lean on; her notes, taste and
// restores only arrive in part "full", after the playbook proposal is saved.
import { loadPlaybook, loadAudience, loadPositions } from './config.js';
import { createFencer } from './fence.js';
import { addProposals } from './proposals.js';
import { PLAYBOOK, AUDIENCE, POSITIONS } from './prompts.js';
import { mean, localDate } from './text.js';

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
  ].join('\n');
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
    const pb = `## Current playbook\n${playbook.map((b) => `- ${b}`).join('\n') || '(empty)'}`;
    if (part === 'numbers') {
      return { part, text: [`# Weekly report, part 1: numbers`, PLAYBOOK, pb, nums,
        'Save playbook proposals with studio_save_weekly({playbook: [{op, text, old, reason}]}), then call studio_weekly_brief({part: "full"}).'].join('\n\n') };
    }
    const fz = createFencer();
    const a = loadAudience(ctx.store);
    const notes = db.feedback.filter((f) => now - Date.parse(f.at) < 7 * DAY).map((f) => ({ post: f.prior_text, her_note: f.text }));
    const restores = db.reversals.filter((r) => now - Date.parse(r.at) < 7 * DAY).map((r) => ({ post: r.line, reason: r.reason }));
    const topicCounts = {};
    for (const d of db.drafts.filter((x) => now - Date.parse(x.created_at) < 7 * DAY)) topicCounts[d.tags?.topic || 'other'] = (topicCounts[d.tags?.topic || 'other'] || 0) + 1;
    return { part, text: [`# Weekly report, part 2: the rest`, fz.guard, nums, taste(db, now),
      fz.block('Her notes this week', notes), fz.block('Kills she undid, with her reasons', restores),
      `## Audience profile\n${[...a.who.map((w) => `- who (${w.confidence}/5): ${w.text}`), ...a.buttons.map((b) => `- button (${b.confidence}/5): ${b.text}`)].join('\n') || '(empty)'}`,
      `Evidence refs: ${Object.entries(topicCounts).map(([k, v]) => `topic:${k}=${v}`).join(', ') || 'none'}`, AUDIENCE(2),
      `## Positions\n${loadPositions(ctx.store).map((p) => `- (${p.strength}/5) ${p.text}`).join('\n') || '(none)'}`, POSITIONS,
      'Finish with studio_save_weekly({summary, audience: [...], positions: [...]}). The summary is 4-8 plain sentences for her: what worked, what didn\'t, what to try.'].filter(Boolean).join('\n\n') };
  });
}

export function saveWeekly(ctx, { summary, playbook = [], audience = [], positions = [] }) {
  const now = ctx.now();
  return ctx.tx((db) => {
    const tag = (kind) => (p) => ({ ...p, kind });
    const res = addProposals(ctx, db, [...playbook.map(tag('playbook')), ...audience.map(tag('audience')), ...positions.map(tag('position'))], 'weekly');
    const file = `reports/weekly-${localDate(now)}.md`;
    const prior = ctx.store.readFile(file, '') || '';
    const prev = prior.match(/<!-- summary -->\n([\s\S]*?)\n<!-- \/summary -->/)?.[1] || '';
    const props = db.proposals.filter((p) => p.source === 'weekly' && now - Date.parse(p.created_at) < DAY);
    const body = [`# Weekly report ${localDate(now)}`, `<!-- summary -->\n${(summary || prev || '(summary pending)').trim()}\n<!-- /summary -->`,
      numbers(db, now), taste(db, now),
      `## Proposed changes (accept or reject on the board's Playbook view)\n${props.map((p) => `- ${p.kind} ${p.op}: ${p.text || p.old}${p.reason ? ` — ${p.reason}` : ''}`).join('\n') || '- none'}`].join('\n\n');
    ctx.store.writeFile(file, body + '\n');
    return { ...res, report: `${ctx.store.home}/${file}`, text: `Saved ${res.added.length} proposal(s)${res.rejected.length ? `, rejected ${res.rejected.length} (${res.rejected.map((r) => r.reason).join(' ')})` : ''}. Report: ${file}` };
  });
}
