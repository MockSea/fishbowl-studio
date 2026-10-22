// The studio_* tools: definitions (for tools/list) and handlers. The model does the thinking;
// these tools do the bookkeeping. Non-UI tools return text only, so every host shows the same thing.
import { fetchAll, wander, recordWander } from './ingest.js';
import { triageQueue, recordTriage } from './triage.js';
import { draftingBrief } from './briefs.js';
import { saveTakes } from './save.js';
import { act, ACTION_NAMES } from './act.js';
import { releaseTool, statusTool, runRelease } from './run.js';
import { weeklyBrief, saveWeekly } from './weekly.js';
import { proposalsTool } from './proposals.js';
import { metricsTool } from './metrics.js';
import { draftsView, readsView, playbookView, settingsView, header, draftsText } from './views.js';
import { configFiles, validateConfig, parseJson } from './config.js';

export const UI_URI = 'ui://studio/board';
const BOARD_META = { ui: { resourceUri: UI_URI, visibility: ['model', 'app'] }, 'ui/resourceUri': UI_URI };
const BOTH = { ui: { visibility: ['model', 'app'] } };

const obj = (properties = {}, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });
const int = (description) => ({ type: 'integer', description });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const NONE = { type: 'object', additionalProperties: false };

const take = obj({ text: str('The exact post text'), thinking: str('2-3 private sentences'), topic: str('One topic slug from the brief'), cites: { type: 'array', items: { type: 'integer' }, description: 'Evergreen only: reading-memory numbers this post relies on' } }, ['text']);
const proposal = { type: 'object', properties: { op: str('add | remove | replace (playbook); add | strengthen | weaken | drop (position); add | raise | lower | drop (audience)'), text: str('New text'), old: str('Existing line this changes'), reason: str('Why, in a few words'), refs: { type: 'array', items: { type: 'string' } }, section: str('audience only: who | buttons') }, required: ['op'] };

export const TOOLS = [
  { name: 'studio_status', title: 'Studio status', description: 'Where the studio stands: setup state, today\'s counter (released of cap, held, next batch, scrapped), drafts waiting, queued jobs, untriaged items, open proposals. Also releases any batch that is due. Call this first in any studio skill.', inputSchema: NONE },
  { name: 'studio_board', title: 'Open the review board', description: 'Open the review board (waiting / passed / killed / scrapped drafts, Reads, Playbook, Settings). Use when she wants to review drafts or says "show me the board". Also returns a text list, for when the board can\'t render.', inputSchema: NONE, _meta: BOARD_META },
  { name: 'studio_view', title: 'Board data', description: 'List drafts or other board views as text plus data. view: drafts | reads | playbook | settings. For drafts: tab waiting | passed | killed | scrapped, chip filter, platform. Used by the board and by the chat review.', inputSchema: obj({ view: str('drafts | reads | playbook | settings'), tab: str('waiting | passed | killed | scrapped'), chip: str('filter chip, default all'), platform: str('all | linkedin | x'), offset: int('paging offset') }), _meta: BOTH },
  { name: 'studio_act', title: 'Act on a draft', description: `Her verdicts and actions. action: ${ACTION_NAMES.join(' | ')}. pass and edit need the draft's hash (from the list) so a stale view can't overwrite a rewrite. pick = choose a take from a set; none = none of these (set_id, optional note); redo = new takes for a set (set_id, note); restore needs reason; heart target draft | thinking | read; note queues a rewrite; draft_this takes id (a draft's thinking) or item_id (a read); mark_posted takes optional url.`, inputSchema: obj({ action: str('the action'), id: int('draft id (or item id for heart target read)'), set_id: int('set id'), item_id: int('item id for draft_this on a read'), hash: str('fingerprint of the text she saw'), text: str('edited text, or the note'), and_pass: { type: 'boolean' }, note: str('note on a set, or a heart note'), reason: str('restore reason'), url: str('link to the live post'), target: str('heart target: draft | thinking | read') }, ['action']), _meta: BOTH },
  { name: 'studio_config', title: 'Studio settings files', description: `Read or write the studio's files in the data folder: ${configFiles().join(', ')}. action get (no file = all), set (replace a file; JSON files take an object, .md files take text) or patch (settings.json only: merge keys).`, inputSchema: obj({ action: str('get | set | patch'), file: str('file name'), content: { description: 'object for .json, string for .md' }, patch: { type: 'object', description: 'settings keys to change' } }, ['action']), _meta: BOTH },
  { name: 'studio_fetch', title: 'Fetch the news', description: 'Fetch every feed in sources.json, dedupe by URL and by story, and store new items. Returns counts and any dead feeds.', inputSchema: NONE },
  { name: 'studio_wander', title: 'Wander', description: 'One curiosity visit to a source on her reading list (chosen by interest, neglect and caps). Returns fenced material; reply with studio_record_wander. Says done when caps are reached.', inputSchema: NONE },
  { name: 'studio_record_wander', title: 'Record wander findings', description: 'Save up to two findings from a wander visit.', inputSchema: obj({ visit_id: int('from studio_wander'), findings: { type: 'array', items: obj({ item: int('item number'), finding: str('your reaction, under 240 chars'), question: str('open question, under 160 chars'), interest: int('0-10') }, ['item', 'finding']) } }, ['visit_id']) },
  { name: 'studio_triage_queue', title: 'Triage queue', description: 'The newest untriaged stories (up to 40), fenced, with instructions. Reply with studio_record_triage.', inputSchema: NONE },
  { name: 'studio_record_triage', title: 'Record triage', description: 'Save one private reaction, a 0-10 interest and a topic per item.', inputSchema: obj({ queue_id: int('from studio_triage_queue'), reactions: { type: 'array', items: obj({ item: int('item number'), thought: str('under 15 words'), interest: int('0-10'), topic: str('topic slug') }, ['item', 'interest']) } }, ['queue_id', 'reactions']) },
  { name: 'studio_drafting_brief', title: 'Next drafting brief', description: 'The next piece of drafting work, with everything needed to write it: queued rewrites and redos first, then the best triaged stories, then evergreen posts. Pass evergreen:true (and count) to force evergreen posts, or job_id for a specific job. Says done when there is nothing left.', inputSchema: obj({ job_id: int('a queued job'), item_id: int('draft this story now'), evergreen: { type: 'boolean' }, count: int('evergreen: how many posts'), jobs_only: { type: 'boolean', description: 'only queued rewrites, redos and draft-this requests' } }) },
  { name: 'studio_save_takes', title: 'Save takes', description: 'Submit the takes for a brief. The server lints them and checks variety and privacy; it either asks for specific redrafts (once) or saves them.', inputSchema: obj({ brief_id: int('from studio_drafting_brief'), takes: { type: 'array', items: take } }, ['brief_id', 'takes']) },
  { name: 'studio_release', title: 'Release due batch', description: 'Rank the held drafts and release the due batch to her review queue (the day\'s ten). Safe to call any time; does nothing if no batch is due.', inputSchema: NONE },
  { name: 'studio_weekly_brief', title: 'Weekly report brief', description: 'Weekly report material. part "numbers" first (write playbook proposals from it), then part "full" (notes, taste, audience, positions).', inputSchema: obj({ part: str('numbers | full') }) },
  { name: 'studio_save_weekly', title: 'Save weekly report', description: 'Save the weekly summary and proposals (playbook, audience, positions). Proposals wait for her on the Playbook view.', inputSchema: obj({ summary: str('4-8 plain sentences'), playbook: { type: 'array', items: proposal }, audience: { type: 'array', items: proposal }, positions: { type: 'array', items: proposal } }) },
  { name: 'studio_proposals', title: 'Proposals', description: 'List, accept or reject proposals, or propose new ones (kind playbook | position | audience | shape). Shapes need name + text (the mechanism).', inputSchema: obj({ action: str('list | accept | reject | propose'), id: int('proposal id'), proposals: { type: 'array', items: { type: 'object' } } }, ['action']), _meta: BOTH },
  { name: 'studio_metrics', title: 'Post numbers', description: 'Enter numbers for a post she published (action add: draft_id, views, likes, replies, reposts, quotes) or import a CSV export of platform analytics (action import_csv: csv text, optional platform). Rows match posts by link or text.', inputSchema: obj({ action: str('add | import_csv'), draft_id: int('draft id'), views: int(''), likes: int(''), replies: int(''), reposts: int(''), quotes: int(''), csv: str('CSV text'), platform: str('linkedin | x') }, ['action']), _meta: BOTH },
];

let seq = 0;
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const withData = (t, data) => ({ content: [{ type: 'text', text: t }], structuredContent: data });

function view(ctx, args = {}) {
  return ctx.tx((db) => {
    runRelease(ctx, db);
    const head = header(ctx, db);
    const v = args.view || 'drafts';
    let data, summary;
    if (v === 'reads') { data = readsView(ctx, db, args); summary = data.reads.map((r) => `[item ${r.id}] ${r.interest}/10 · ${r.note} — ${r.title}`).join('\n') || 'No reads yet.'; }
    else if (v === 'playbook') { data = playbookView(ctx, db); summary = `Playbook:\n${data.playbook.map((b) => `- ${b}`).join('\n') || '(empty)'}\nOpen proposals: ${data.proposals.map((p) => `#${p.id} ${p.kind} ${p.op}: ${p.text || p.old}`).join('; ') || 'none'}`; }
    else if (v === 'settings') { data = settingsView(ctx); summary = `Data folder: ${data.home}\nDaily cap ${data.settings.daily_cap}, release hours ${data.settings.release_hours.join(', ')}, platforms ${data.platforms.filter((p) => p.enabled).map((p) => p.name).join(', ')}; ${data.feeds.length} feeds.`; }
    else { data = draftsView(ctx, db, args); summary = draftsText(data, head); }
    return { ...data, header: head, stamp: { createdAt: ctx.now(), seq: ++seq }, summary };
  });
}

function configTool(ctx, { action, file, content, patch }) {
  const s = ctx.store;
  if (action === 'get') {
    const files = file ? [file] : configFiles();
    return text(files.map((f) => `=== ${f} ===\n${s.readFile(f, '(not created yet)')}`).join('\n\n') + `\n\nData folder: ${s.home}`);
  }
  if (action === 'patch') {
    if (file && file !== 'settings.json') throw new Error('patch only works on settings.json');
    const cur = parseJson(s.readFile('settings.json'), {});
    const next = validateConfig('settings.json', { ...cur, ...(patch || content || {}) });
    s.writeFile('settings.json', JSON.stringify(next, null, 2) + '\n');
    return text(`Updated settings: ${Object.keys(patch || content || {}).join(', ')}.`);
  }
  if (action === 'set') {
    if (!file) throw new Error('set needs a file');
    const value = file.endsWith('.json') ? validateConfig(file, typeof content === 'string' ? JSON.parse(content) : content) : validateConfig(file, content);
    s.writeFile(file, file.endsWith('.json') ? JSON.stringify(value, null, 2) + '\n' : value);
    return text(`Saved ${file} in ${s.home}.`);
  }
  throw new Error('action must be get, set or patch');
}

const json = (o) => text(o.text || JSON.stringify(o, null, 1));

export const HANDLERS = {
  studio_status: (ctx) => json(statusTool(ctx)),
  studio_board: (ctx) => { const v = view(ctx, { view: 'drafts', tab: 'waiting' }); return withData(`${v.summary}\n\nThe board is open above. If it doesn't show, review here: tell me e.g. "pass 1a, kill 2, edit 3: ...".`, v); },
  studio_view: (ctx, a) => { const v = view(ctx, a); return withData(v.summary, v); },
  studio_act: (ctx, a) => { const r = act(ctx, a); return { content: [{ type: 'text', text: r.message }], structuredContent: r, ...(r.ok ? {} : { isError: true }) }; },
  studio_config: (ctx, a) => configTool(ctx, a),
  studio_fetch: async (ctx) => { const r = await fetchAll(ctx); return text(r.note || `Fetched ${r.feeds} feed(s): ${r.added} new item(s), ${r.dupes} already seen, ${r.clustered} grouped with a story from another outlet, ${r.pruned} old item(s) pruned.${r.errors.length ? `\nDead or failing feeds: ${r.errors.map((e) => `${e.name} (${e.error})`).join('; ')}` : ''}`); },
  studio_wander: async (ctx) => json(await wander(ctx)),
  studio_record_wander: (ctx, a) => json({ ...recordWander(ctx, a), text: undefined }),
  studio_triage_queue: (ctx) => json(triageQueue(ctx)),
  studio_record_triage: (ctx, a) => { const r = recordTriage(ctx, a); return text(`Saved ${r.saved} reaction(s); ${r.worth_drafting} at or above the drafting threshold (${r.threshold}).`); },
  studio_drafting_brief: (ctx, a) => json(draftingBrief(ctx, a)),
  studio_save_takes: (ctx, a) => json(saveTakes(ctx, a)),
  studio_release: (ctx) => json(releaseTool(ctx)),
  studio_weekly_brief: (ctx, a) => json(weeklyBrief(ctx, a)),
  studio_save_weekly: (ctx, a) => json(saveWeekly(ctx, a)),
  studio_proposals: (ctx, a) => { const r = proposalsTool(ctx, a); return withData(r.text || r.message, r); },
  studio_metrics: (ctx, a) => json(metricsTool(ctx, a)),
};

export async function callTool(ctx, name, args = {}) {
  const h = HANDLERS[name];
  if (!h) { const e = new Error(`Unknown tool: ${name}`); e.code = -32602; throw e; }
  try { return await h(ctx, args || {}); }
  catch (e) { return { content: [{ type: 'text', text: String(e.message || e) }], isError: true }; }
}
