// Account slots. Each type is one small file in accounts/ (label, icon, what it enables, a
// `connect` prompt, capabilities, and for posting a `compose` address and a `post_warning`).
// Adding a type is adding a file. No credentials, tokens or cookies are ever stored: "Add account"
// queues the type's prompt for Claude, which walks them through signing in in their own browser, and
// the studio records only that the account was connected that way.
//
// Capabilities are `read` and `post`, each false (not built), "prompt" (only when they ask Claude
// in chat) or true (built). `post: true` means Claude can post approved drafts through their own
// signed-in browser, and only once they turn "Post for me" on for that account on the board
// (posting.js). handOff() is the one gate every post goes through.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oneLine } from './text.js';
import { safeHttpsUrl } from './urls.js';

// Resolved here rather than imported from config.js, which imports this file.
export const ACCOUNTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'accounts');
const CAP_VALUES = [false, 'prompt', true];
const ID_RE = /^[a-z][a-z0-9-]{0,29}$/;

export function validateAccountType(t, file = 'account type') {
  if (!t || !ID_RE.test(t.id || '')) throw new Error(`${file}: id must be a short lowercase slug`);
  for (const k of ['label', 'enables', 'connect']) if (typeof t[k] !== 'string' || !t[k].trim()) throw new Error(`${file}: needs ${k}`);
  const caps = t.capabilities || {};
  for (const c of ['read', 'post']) if (!CAP_VALUES.includes(caps[c] ?? false)) throw new Error(`${file}: capabilities.${c} must be false, "prompt" or true`);
  // A type that can post says where Claude opens the composer, and what they risk.
  let compose = null, prefill = null;
  if (caps.post === true) {
    const u = safeHttpsUrl(t.compose);
    if (!u.ok) throw new Error(`${file}: a type that can post needs a compose address (${u.reason})`);
    if (typeof t.post_warning !== 'string' || !t.post_warning.trim()) throw new Error(`${file}: a type that can post needs a post_warning`);
    compose = u.url;
    // Optional: the platform's documented intent address that opens the composer with the text
    // already in it, so the posting run lands on a compose page instead of their feed.
    if (t.prefill != null) {
      const p = typeof t.prefill === 'string' && t.prefill.split('{text}').length === 2 ? safeHttpsUrl(t.prefill.replace('{text}', 'x')) : { ok: false, reason: 'must contain {text} once' };
      if (!p.ok) throw new Error(`${file}: prefill must be an https address with {text} in it (${p.reason})`);
      prefill = t.prefill;
    }
  }
  return {
    id: t.id, label: oneLine(t.label).slice(0, 40), icon: typeof t.icon === 'string' ? t.icon.slice(0, 30) : null,
    enables: oneLine(t.enables).slice(0, 300), connect: oneLine(t.connect).slice(0, 1200),
    capabilities: { read: caps.read ?? false, post: caps.post ?? false },
    compose, prefill, post_warning: compose ? oneLine(t.post_warning).slice(0, 300) : null,
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

// "Post for me" for one connected account: off unless they turned it on on the board.
export const postingOn = (row) => row?.posting?.on === true;

// Their connected accounts for this persona, with their type and whether Claude posts for them.
export function accountsView(ctx, db) {
  const types = accountTypes();
  const connected = db.accounts || [];
  return Object.values(types).map((t) => {
    const a = connected.find((x) => x.type === t.id);
    const hist = a?.posting?.history || [];
    return { ...t, connected: !!a, status: a?.status || null, connected_at: a?.at || null,
      posting: { on: postingOn(a), since: hist.length ? hist[hist.length - 1].at : null, history: hist.slice(-6) } };
  });
}

// Board only: record that they connected (or removed) an account by following the prompt.
export function setAccount(ctx, { action, type }) {
  const t = accountTypes()[type];
  if (!t) throw new Error(`Unknown account type "${type}". Known: ${Object.keys(accountTypes()).join(', ')}`);
  return ctx.tx((db) => {
    const i = db.accounts.findIndex((a) => a.type === type);
    if (action === 'connect') {
      // Reconnecting keeps their posting choice and its history; a new connection starts with it off.
      const row = { type, status: 'connected_by_prompt', at: ctx.iso(), ...(i >= 0 && db.accounts[i].posting ? { posting: db.accounts[i].posting } : {}) };
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

// The posting hook: may this approved draft be handed to this account to post? Every post is
// checked here when it is scheduled and again just before it goes out. It only answers; it never
// turns posting on and never approves anything.
export function handOff(ctx, { draft_id, type }, db = null) {
  if (!db) return ctx.tx((d) => handOff(ctx, { draft_id, type }, d));
  const d = db.drafts.find((x) => x.id === Number(draft_id));
  if (!d || !['passed', 'edited'].includes(d.status)) return { ok: false, message: 'Only an approved draft can be handed to an account.' };
  const a = db.accounts.find((x) => x.type === type);
  if (!a) return { ok: false, message: 'That account isn\'t connected.' };
  if (!canPost(type)) return { ok: false, message: 'The studio can\'t post to that account. Copy the post and publish it yourself.' };
  if (!postingOn(a)) return { ok: false, message: '"Post for me" is off for that account. Copy the post and publish it yourself.' };
  const t = accountTypes()[type];
  return { ok: true, compose: t.compose, prefill: t.prefill };
}
