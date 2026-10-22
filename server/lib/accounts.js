// Account slots: scaffolding for signing in to a platform later. Each type is one small file in
// accounts/ (label, icon, what it would enable, a `connect` prompt, and capabilities). Adding a
// type is adding a file. No credentials, tokens or cookies are ever stored: "Add account" queues
// the type's prompt for Claude, which walks her through signing in in her own browser, and the
// studio records only that the account was connected that way.
//
// Capabilities are `read` and `post`, each false (not built), "prompt" (only when she asks Claude
// in chat) or true (built). Every type is false today. Posting, when it comes, plugs in at
// handOff() through an official API or a scheduler service, never browser automation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oneLine } from './text.js';

// Resolved here rather than imported from config.js, which imports this file.
export const ACCOUNTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'accounts');
const CAP_VALUES = [false, 'prompt', true];
const ID_RE = /^[a-z][a-z0-9-]{0,29}$/;

export function validateAccountType(t, file = 'account type') {
  if (!t || !ID_RE.test(t.id || '')) throw new Error(`${file}: id must be a short lowercase slug`);
  for (const k of ['label', 'enables', 'connect']) if (typeof t[k] !== 'string' || !t[k].trim()) throw new Error(`${file}: needs ${k}`);
  const caps = t.capabilities || {};
  for (const c of ['read', 'post']) if (!CAP_VALUES.includes(caps[c] ?? false)) throw new Error(`${file}: capabilities.${c} must be false, "prompt" or true`);
  return {
    id: t.id, label: oneLine(t.label).slice(0, 40), icon: typeof t.icon === 'string' ? t.icon.slice(0, 30) : null,
    enables: oneLine(t.enables).slice(0, 300), connect: oneLine(t.connect).slice(0, 1200),
    capabilities: { read: caps.read ?? false, post: caps.post ?? false },
  };
}

const cache = new Map();
export function accountTypes(dir = ACCOUNTS_DIR) {
  if (cache.has(dir)) return cache.get(dir);
  const list = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => validateAccountType(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), f)) : [];
  const out = Object.fromEntries(list.map((t) => [t.id, t]));
  cache.set(dir, out);
  return out;
}

export const canRead = (type) => accountTypes()[type]?.capabilities.read === true;
export const canPost = (type) => accountTypes()[type]?.capabilities.post === true;

// Her connected accounts for this persona, with their type.
export function accountsView(ctx, db) {
  const types = accountTypes();
  const connected = db.accounts || [];
  return Object.values(types).map((t) => {
    const a = connected.find((x) => x.type === t.id);
    return { ...t, connected: !!a, status: a?.status || null, connected_at: a?.at || null };
  });
}

// Board only: record that she connected (or removed) an account by following the prompt.
export function setAccount(ctx, { action, type }) {
  const t = accountTypes()[type];
  if (!t) throw new Error(`Unknown account type "${type}". Known: ${Object.keys(accountTypes()).join(', ')}`);
  return ctx.tx((db) => {
    const i = db.accounts.findIndex((a) => a.type === type);
    if (action === 'connect') {
      const row = { type, status: 'connected_by_prompt', at: ctx.iso() };
      if (i >= 0) db.accounts[i] = row; else db.accounts.push(row);
      return { ok: true, prompt: t.connect, message: `Asked Claude to help you sign in to ${t.label}. Nothing is stored but a note that it's connected.` };
    }
    if (action === 'remove') {
      if (i < 0) return { ok: false, message: `${t.label} isn't connected.` };
      db.accounts.splice(i, 1);
      return { ok: true, message: `Removed ${t.label}. Sign out in your browser too if you like.` };
    }
    throw new Error('action must be connect or remove');
  });
}

// The posting hook. An approved draft could be handed to an account that can post; none can
// today, so this always refuses and posting stays copy-and-paste.
export function handOff(ctx, { draft_id, type }) {
  return ctx.tx((db) => {
    const d = db.drafts.find((x) => x.id === Number(draft_id));
    if (!d || !['passed', 'edited'].includes(d.status)) return { ok: false, message: 'Only an approved draft can be handed to an account.' };
    if (!db.accounts.some((a) => a.type === type)) return { ok: false, message: 'That account isn\'t connected.' };
    if (!canPost(type)) return { ok: false, message: 'Posting from the studio isn\'t built. Copy the post and publish it yourself.' };
    return { ok: false, message: 'Posting isn\'t built yet.' };
  });
}
