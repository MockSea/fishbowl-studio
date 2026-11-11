// The daily run, the rewrite queue and the setup drafts. The app runs the loop (fetch, triage,
// draft, release) and only the writing goes to the model, through whichever engine is picked
// (engines/index.js). Reading watched social accounts and wandering need a browser, so the run
// leaves them out.
import fs from 'node:fs';
import path from 'node:path';
import { fetchAll } from './ingest.js';
import { triageQueue, recordTriage, skipTriage } from './triage.js';
import { draftingBrief } from './briefs.js';
import { saveTakes, abandonBrief } from './save.js';
import { releaseTool } from './run.js';
import { wizardBrief, wizardSave } from './wizard.js';
import { editProposals } from './weekly.js';
import { SCHEMAS, ModelError } from './engines/api.js';

const MAX_TRIAGE_ROUNDS = 10;
// The most model calls one run may make. A brief takes one to three calls, so a full day (a few
// triage rounds, twelve stories, the evergreen set) fits; a run that hits it stops and saves
// what it has.
export const MAX_CALLS_PER_RUN = 40;
export const CALLS_PER_BRIEF = 3;
// Answers the model got wrong for this brief or triage batch only: the brief is closed as dropped,
// the batch is closed at interest 0, and the run moves on. Anything else (auth, network, rate
// limits) ends the run with the brief or batch left open.
const BRIEF_ERRORS = new Set(['refusal', 'max_tokens', 'parse']);

// The most model calls in one calendar day (local time), across every run and brand.
export const MAX_CALLS_PER_DAY = 150;

// The daily cap, kept in a small file so a restart doesn't reset it. file null keeps it in memory.
export function makeDailyCap({ file = null, cap = MAX_CALLS_PER_DAY, now = () => Date.now() } = {}) {
  let mem = { day: null, calls: 0 };
  const day = () => { const d = new Date(now()); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const read = () => {
    let u = mem;
    if (file) { try { u = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { u = { day: null, calls: 0 }; } }
    return u.day === day() && Number.isFinite(u.calls) ? u : { day: day(), calls: 0 };
  };
  const write = (u) => {
    mem = u;
    if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(u) + '\n'); }
  };
  return {
    cap,
    used: () => read().calls,
    left: () => Math.max(0, cap - read().calls),
    spend() { const u = read(); write({ day: u.day, calls: u.calls + 1 }); },
  };
}

// A model call counter. Every call through budget.ask spends one from the run and one from the
// day; run out of either and asks throw. Both engines go through here.
export function makeBudget(model, calls = MAX_CALLS_PER_RUN, daily = null) {
  const b = {
    left: calls, used: 0,
    can: (n = 1) => b.left >= n && (!daily || daily.left() >= n),
    async ask(opts) {
      if (b.left <= 0) throw new Error('This run used all its model calls.');
      if (daily && daily.left() <= 0) throw new Error(`Today's ${daily.cap} model calls are used up. Runs start again tomorrow.`);
      b.left--; b.used++;
      daily?.spend();
      return model.ask(opts);
    },
  };
  return b;
}

// model: {ask(opts)}; kit(slug): {docs, images}; progress(event) for the window.
export function makeRunner({ ctx, model, kit, progress = () => {}, daily = null }) {
  const busy = new Set();

  // budget: a shared counter (the timer passes one for the whole tick); otherwise a fresh one.
  async function once(slug, kind, fn, budget) {
    if (busy.has(slug)) return { ok: false, message: 'A run for this brand is already going.' };
    busy.add(slug);
    progress({ slug, kind, state: 'start' });
    try {
      const r = await fn(ctx.persona(slug), kit(slug), budget || makeBudget(model, MAX_CALLS_PER_RUN, daily));
      progress({ slug, kind, state: 'done', message: r.message });
      return { ok: true, ...r };
    } catch (e) {
      progress({ slug, kind, state: 'error', message: e.message });
      return { ok: false, message: e.message };
    } finally { busy.delete(slug); }
  }

  async function triage(c, k, budget) {
    let saved = 0;
    for (let i = 0; i < MAX_TRIAGE_ROUNDS && budget.can(); i++) {
      const q = triageQueue(c);
      if (q.done) break;
      let out;
      try {
        out = await budget.ask({ task: q.text, schema: SCHEMAS.triage, kit: k, effort: 'low', maxTokens: 8000 });
      } catch (e) {
        // A batch the model got wrong is closed at interest 0 and the run goes on to drafting.
        if (!(e instanceof ModelError && BRIEF_ERRORS.has(e.kind))) throw e;
        skipTriage(c, { queue_id: q.queue_id });
        continue;
      }
      const r = recordTriage(c, { queue_id: q.queue_id, reactions: out.reactions });
      saved += r.saved;
    }
    return saved;
  }

  // One brief at a time until the queue is empty or the budget can't cover another brief. Each
  // story or job is tried once per run: if the queue hands back one already tried, the run stops.
  async function draft(c, k, budget, args = {}) {
    let drafts = 0, briefs = 0;
    const tried = new Set();
    while (budget.can(CALLS_PER_BRIEF)) {
      const b = draftingBrief(c, args);
      if (b.done) break;
      const key = b.job_id != null ? `job:${b.job_id}` : b.item_id != null ? `item:${b.item_id}` : `${b.kind}`;
      if (tried.has(key)) { abandonBrief(c, b.brief_id); break; }
      tried.add(key);
      briefs++;
      try {
        const r = await writeBrief(c, k, budget, b);
        if (r.status === 'saved') drafts += r.drafts.length;
      } catch (e) {
        if (!(e instanceof ModelError && BRIEF_ERRORS.has(e.kind)) && !e.brief) throw e;
        abandonBrief(c, b.brief_id);
      }
    }
    return { drafts, briefs };
  }

  // The brief asks for exactly b.takes takes: extras are cut, too few gets one more ask, and a
  // brief that still comes back short is closed as dropped.
  async function writeBrief(c, k, budget, b) {
    const ask = async (task) => (await budget.ask({ task, schema: SCHEMAS.takes, kit: k, effort: 'medium' })).takes.slice(0, b.takes);
    const short = (takes) => { if (takes.length < b.takes) throw Object.assign(new Error(`The model sent ${takes.length} of ${b.takes} takes.`), { brief: true }); return takes; };
    let takes = await ask(b.text);
    if (takes.length < b.takes) takes = short(await ask(`${b.text}\n\n## The studio sent these back\nThat was ${takes.length}; this brief needs exactly ${b.takes}.`));
    let r = saveTakes(c, { brief_id: b.brief_id, takes });
    if (r.status === 'redraft') r = saveTakes(c, { brief_id: b.brief_id, takes: short(await ask(`${b.text}\n\n## The studio sent these back\n${r.text}\n\nYour takes were:\n${JSON.stringify(takes)}`)) });
    return r;
  }

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  return {
    busy: (slug) => busy.has(slug),
    // A counter several runs can share (the timer uses one per tick).
    budget: (calls) => makeBudget(model, calls, daily),
    dailyCap: daily,

    // force: Run it now (always reads). Without it (the timer), a run that didn't read new news
    // and has no queued jobs only releases batches: it makes no model calls.
    daily: (slug, { force = false, budget } = {}) => once(slug, 'daily', async (c, k, bud) => {
      if (!c.settings().setup_complete) return { message: 'Finish setting up this brand first.' };
      const f = await fetchAll(c, { force });
      const queued = c.tx((db) => db.jobs.some((j) => j.status === 'queued'));
      // Patterns in their edits become playbook proposals (no model call). The plugin does this
      // in its weekly report; the app has none, so it happens on every run.
      c.tx((db) => editProposals(c, db));
      if (!force && (f.skipped || !f.feeds) && !queued) {
        releaseTool(c);
        return { message: f.note || 'Nothing new to read.', fetched: 0, triaged: 0, drafts: 0, calls: 0 };
      }
      const triaged = await triage(c, k, bud);
      const d = await draft(c, k, bud);
      releaseTool(c);
      const read = f.note ? f.note : `Read ${f.added} new ${f.added === 1 ? 'story' : 'stories'}`;
      const capped = bud.can(CALLS_PER_BRIEF) ? ''
        : daily && daily.left() < CALLS_PER_BRIEF ? ` It stopped at today's limit of ${daily.cap} model calls; the rest waits for tomorrow.`
          : ' It stopped at its limit of model calls; the rest waits for the next run.';
      return { message: `${read}. Triaged ${triaged}, wrote ${plural(d.drafts, 'draft')}.${capped}`, fetched: f.added || 0, triaged, drafts: d.drafts, calls: bud.used };
    }, budget),

    jobs: (slug) => once(slug, 'jobs', async (c, k, bud) => {
      const d = await draft(c, k, bud, { jobs_only: true });
      releaseTool(c);
      return { message: d.briefs ? `Wrote ${plural(d.drafts, 'draft')} from the queue.` : 'Nothing was waiting.', drafts: d.drafts };
    }),

    wizard: (slug) => once(slug, 'wizard', async (c, k, bud) => {
      const b = await wizardBrief(c, { kinds: ['site', 'reddit'] });
      if (b.done) return { message: b.text };
      const out = await bud.ask({ task: b.text, schema: SCHEMAS.wizard, kit: k, effort: 'medium' });
      // The desktop app reads sites and subreddits only; anything else is not suggested.
      const sources = (out.sources || []).filter((s) => s.kind === 'site' || s.kind === 'reddit').map((s) => ({
        kind: s.kind, topic: s.topic, reason: s.reason, ...(s.kind === 'site' ? { url: s.url } : { sub: s.sub }),
      }));
      const r = wizardSave(c, { brief_id: b.brief_id, voice: out.voice, playbook: out.playbook, topics: out.topics, off_limits: out.off_limits, audience: out.audience, sources });
      if (!r.ok) throw new Error(r.message);
      return { message: r.message };
    }),
  };
}
