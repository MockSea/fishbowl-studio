// Proposals: the model only suggests. Playbook bullets, positions, audience lines and learned
// shapes land here as open proposals; she accepts or rejects each one on the Playbook view.
import { loadPlaybook, writePlaybook, loadPositions, loadAudience, loadShapes, parseJson } from './config.js';
import { ownWords, INSTRUCTION_RE } from './fence.js';
import { clip } from './text.js';

const KINDS = {
  playbook: ['add', 'remove', 'replace'],
  position: ['add', 'strengthen', 'weaken', 'drop'],
  audience: ['add', 'raise', 'lower', 'drop'],
  shape: ['add'],
};
export const MAX_SHAPES = 40, NEW_SHAPES_PER_RUN = 3;

export function validateProposal(p) {
  if (!KINDS[p.kind]) throw new Error(`Unknown proposal kind "${p.kind}". Kinds: ${Object.keys(KINDS).join(', ')}`);
  if (!KINDS[p.kind].includes(p.op)) throw new Error(`A ${p.kind} proposal's op must be one of ${KINDS[p.kind].join(', ')}`);
  const text = String(p.text || p.mechanism || '').trim();
  const needsText = !['remove', 'drop', 'strengthen', 'weaken', 'raise', 'lower'].includes(p.op);
  if (needsText) {
    const ow = ownWords(text, [], {});
    if (!ow.ok) throw new Error(`Proposal rejected: ${ow.reason}.`);
  } else if (!String(p.old || p.text || '').trim()) throw new Error(`A ${p.op} proposal must name the existing line in "old".`);
  if (INSTRUCTION_RE.test(String(p.reason || ''))) throw new Error('The reason reads like an instruction.');
  if (p.kind === 'audience' && !['who', 'buttons'].includes(p.section)) throw new Error('An audience proposal needs section "who" or "buttons".');
  if (p.kind === 'shape' && (!p.name || text.split(/\s+/).length > 30)) throw new Error('A shape needs a short name and a mechanism under 25 words.');
  return {
    kind: p.kind, op: p.op, text: clip(text, 300), old: p.old ? clip(String(p.old), 300) : null, reason: clip(String(p.reason || ''), 300),
    refs: (p.refs || []).map(String).slice(0, 8), section: p.section || null, name: p.name ? clip(String(p.name), 60) : null,
    platforms: p.platforms || null, strength: p.strength || null,
  };
}

export function addProposals(ctx, db, list, source) {
  const added = [], rejected = [];
  let shapes = 0;
  for (const raw of list || []) {
    try {
      const p = validateProposal(raw);
      if (p.kind === 'shape' && ++shapes > NEW_SHAPES_PER_RUN) throw new Error('At most 3 new shapes at a time.');
      const dup = db.proposals.find((x) => x.status === 'open' && x.kind === p.kind && x.op === p.op && x.text === p.text && x.old === p.old);
      if (dup) continue;
      const row = { id: ctx.id('proposal'), ...p, source, status: 'open', created_at: ctx.iso() };
      db.proposals.push(row);
      added.push(row.id);
    } catch (e) { rejected.push({ proposal: raw?.text || raw?.name || raw?.old, reason: e.message }); }
  }
  return { added, rejected };
}

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function applyPlaybook(store, p) {
  let bullets = loadPlaybook(store);
  if (p.op === 'add') bullets.push(p.text);
  else {
    const i = bullets.findIndex((b) => same(b, p.old));
    if (i < 0) throw new Error('That bullet is no longer in the playbook.');
    if (p.op === 'remove') bullets.splice(i, 1); else bullets[i] = p.text;
  }
  if (bullets.length > 12) throw new Error('The playbook would have more than 12 bullets. Remove one first.');
  writePlaybook(store, bullets);
}

function applyPosition(store, p) {
  const ps = loadPositions(store);
  const i = ps.findIndex((x) => same(x.text, p.old || p.text));
  if (p.op === 'add') ps.push({ text: p.text, strength: Math.min(5, Math.max(1, p.strength || 3)) });
  else if (i < 0) throw new Error('That position is no longer on the list.');
  else if (p.op === 'drop') ps.splice(i, 1);
  else ps[i].strength = Math.min(5, Math.max(1, ps[i].strength + (p.op === 'strengthen' ? 1 : -1)));
  store.writeFile('positions.json', JSON.stringify({ positions: ps.slice(0, 30) }, null, 2) + '\n');
}

function applyAudience(store, p) {
  const a = loadAudience(store);
  const rows = a[p.section];
  const i = rows.findIndex((x) => same(x.text, p.old || p.text));
  if (p.op === 'add') rows.push({ text: p.text, confidence: 1 });
  else if (i < 0) throw new Error('That line is no longer in the audience profile.');
  else if (p.op === 'drop') rows.splice(i, 1);
  else rows[i].confidence = Math.min(5, Math.max(1, rows[i].confidence + (p.op === 'raise' ? 1 : -1)));
  store.writeFile('audience.json', JSON.stringify(a, null, 2) + '\n');
}

function applyShape(store, p) {
  const learned = parseJson(store.readFile('shapes.json'), { added: [], retired: [] });
  if (loadShapes(store).length >= MAX_SHAPES) throw new Error(`The shape library is full (${MAX_SHAPES}). Retire one first.`);
  const id = String(p.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `shape-${Date.now()}`;
  if (loadShapes(store).some((s) => s.id === id)) throw new Error('A shape with that name already exists.');
  learned.added = [...(learned.added || []), { id, name: p.name, mechanism: p.text, corner: 'learned', platforms: p.platforms || ['linkedin', 'x'], origin: 'read' }];
  store.writeFile('shapes.json', JSON.stringify(learned, null, 2) + '\n');
}

const APPLY = { playbook: applyPlaybook, position: applyPosition, audience: applyAudience, shape: applyShape };

export function proposalsTool(ctx, args) {
  return ctx.tx((db) => {
    if (args.action === 'propose') {
      const res = addProposals(ctx, db, args.proposals, args.source || 'chat');
      return { ...res, text: `Added ${res.added.length} proposal(s) for her to review on the Playbook view${res.rejected.length ? `; rejected ${res.rejected.length}: ${res.rejected.map((r) => r.reason).join(' ')}` : ''}.` };
    }
    if (args.action === 'accept' || args.action === 'reject') {
      const p = db.proposals.find((x) => x.id === Number(args.id));
      if (!p) throw new Error(`No proposal ${args.id}.`);
      if (p.status !== 'open') return { ok: false, message: `Proposal ${p.id} is already ${p.status}.` };
      if (args.action === 'accept') APPLY[p.kind](ctx.store, p);
      Object.assign(p, { status: args.action === 'accept' ? 'accepted' : 'rejected', decided_at: ctx.iso() });
      return { ok: true, message: args.action === 'accept' ? 'Accepted and applied.' : 'Rejected.' };
    }
    const open = db.proposals.filter((p) => p.status === 'open');
    return { proposals: open, text: open.length ? open.map((p) => `#${p.id} ${p.kind} ${p.op}: ${p.text || p.old}${p.reason ? ` (${p.reason})` : ''}`).join('\n') : 'No open proposals.' };
  });
}
