// The daily run, the rewrite queue and the setup drafts, driven from the desktop app. It is the
// same sequence the plugin's skills walk Claude through (fetch, triage, draft, release), but the
// app runs the loop and only the writing goes to the model. Reading watched social accounts and
// wandering need a browser, so the desktop run leaves them out.
import { fetchAll } from '../server/lib/ingest.js';
import { triageQueue, recordTriage } from '../server/lib/triage.js';
import { draftingBrief } from '../server/lib/briefs.js';
import { saveTakes } from '../server/lib/save.js';
import { releaseTool } from '../server/lib/run.js';
import { wizardBrief, wizardSave } from '../server/lib/wizard.js';
import { SCHEMAS } from './llm.js';

const MAX_TRIAGE_ROUNDS = 10;
const MAX_BRIEFS = 40;

// model: {ask(opts)}; kit(slug): {docs, images}; progress(event) for the window.
export function makeRunner({ ctx, model, kit, progress = () => {} }) {
  const busy = new Set();

  async function once(slug, kind, fn) {
    if (busy.has(slug)) return { ok: false, message: 'A run for this brand is already going.' };
    busy.add(slug);
    progress({ slug, kind, state: 'start' });
    try {
      const r = await fn(ctx.persona(slug), kit(slug));
      progress({ slug, kind, state: 'done', message: r.message });
      return { ok: true, ...r };
    } catch (e) {
      progress({ slug, kind, state: 'error', message: e.message });
      return { ok: false, message: e.message };
    } finally { busy.delete(slug); }
  }

  async function triage(c, k) {
    let saved = 0;
    for (let i = 0; i < MAX_TRIAGE_ROUNDS; i++) {
      const q = triageQueue(c);
      if (q.done) break;
      const out = await model.ask({ task: q.text, schema: SCHEMAS.triage, kit: k, effort: 'low', maxTokens: 8000 });
      const r = recordTriage(c, { queue_id: q.queue_id, reactions: out.reactions });
      saved += r.saved;
    }
    return saved;
  }

  async function draft(c, k, args = {}) {
    let drafts = 0, briefs = 0;
    for (; briefs < MAX_BRIEFS; briefs++) {
      const b = draftingBrief(c, args);
      if (b.done) break;
      // The brief asks for exactly b.takes takes: extras are cut, too few gets one more ask.
      const ask = async (task) => (await model.ask({ task, schema: SCHEMAS.takes, kit: k, effort: 'medium' })).takes.slice(0, b.takes);
      let takes = await ask(b.text);
      if (takes.length < b.takes) takes = await ask(`${b.text}\n\n## The studio sent these back\nThat was ${takes.length}; this brief needs exactly ${b.takes}.`);
      let r = saveTakes(c, { brief_id: b.brief_id, takes });
      if (r.status === 'redraft') r = saveTakes(c, { brief_id: b.brief_id, takes: await ask(`${b.text}\n\n## The studio sent these back\n${r.text}\n\nYour takes were:\n${JSON.stringify(takes)}`) });
      if (r.status === 'saved') drafts += r.drafts.length;
    }
    return { drafts, briefs };
  }

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  return {
    busy: (slug) => busy.has(slug),

    daily: (slug, { force = false } = {}) => once(slug, 'daily', async (c, k) => {
      if (!c.settings().setup_complete) return { message: 'Finish setting up this brand first.' };
      const f = await fetchAll(c, { force });
      const triaged = await triage(c, k);
      const d = await draft(c, k);
      releaseTool(c);
      const read = f.note ? f.note : `Read ${f.added} new ${f.added === 1 ? 'story' : 'stories'}`;
      return { message: `${read}. Triaged ${triaged}, wrote ${plural(d.drafts, 'draft')}.`, fetched: f.added || 0, triaged, drafts: d.drafts };
    }),

    jobs: (slug) => once(slug, 'jobs', async (c, k) => {
      const d = await draft(c, k, { jobs_only: true });
      releaseTool(c);
      return { message: d.briefs ? `Wrote ${plural(d.drafts, 'draft')} from the queue.` : 'Nothing was waiting.', drafts: d.drafts };
    }),

    wizard: (slug) => once(slug, 'wizard', async (c, k) => {
      const b = await wizardBrief(c);
      if (b.done) return { message: b.text };
      const out = await model.ask({ task: b.text, schema: SCHEMAS.wizard, kit: k, effort: 'medium' });
      const sources = (out.sources || []).map((s) => ({
        kind: s.kind, topic: s.topic, reason: s.reason,
        ...(s.kind === 'site' ? { url: s.url } : s.kind === 'reddit' ? { sub: s.sub } : { q: s.q }),
      }));
      const r = wizardSave(c, { brief_id: b.brief_id, voice: out.voice, playbook: out.playbook, topics: out.topics, off_limits: out.off_limits, audience: out.audience, sources });
      if (!r.ok) throw new Error(r.message);
      return { message: r.message };
    }),
  };
}
