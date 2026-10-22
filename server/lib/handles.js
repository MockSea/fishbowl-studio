// Strict parsing for the social and search source kinds. Whatever she pastes (a handle, a page
// address, a subreddit, a search) becomes one canonical, validated entry, or a plain refusal.
// The studio only ever builds addresses on x.com, linkedin.com and reddit.com from these, so a
// watch entry can never point anywhere else.
import { instructionPhrase } from './fence.js';
import { oneLine } from './text.js';

const bad = (reason) => ({ ok: false, reason });

const X_HOSTS = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
const LI_HOSTS = new Set(['linkedin.com', 'www.linkedin.com']);
const REDDIT_HOSTS = new Set(['reddit.com', 'www.reddit.com', 'old.reddit.com']);
export const SOCIAL_HOSTS = ['x.com', 'twitter.com', 'linkedin.com', 'reddit.com'];
// x.com paths that are pages, not accounts.
const X_RESERVED = new Set(['home', 'explore', 'search', 'i', 'settings', 'login', 'logout', 'signup', 'messages', 'notifications', 'compose', 'intent', 'share', 'hashtag', 'tos', 'privacy', 'about', 'jobs', 'lists', 'topics', 'communities', 'account']);
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const LI_KINDS = ['company', 'in', 'showcase'];
const LI_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,99}$/;
const SUB_RE = /^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/;

function asUrl(s) {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) return null;
    return u;
  } catch { return null; }
}
const segments = (u) => u.pathname.split('/').filter(Boolean);

function xAccount(h) {
  if (!X_HANDLE_RE.test(h) || X_RESERVED.has(h.toLowerCase())) return bad('that isn\'t an X handle (letters, digits and _, at most 15)');
  return { ok: true, platform: 'x', handle: `@${h}`, url: `https://x.com/${h}` };
}

// An X handle (@name, name, x.com/name) or a LinkedIn company, showcase or profile page.
export function parseWatch(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 300) return bad('paste an X handle like @name, or an x.com or linkedin.com address');
  const m = s.match(/^@?([A-Za-z0-9_]{1,15})$/);
  if (m) return xAccount(m[1]);
  const u = asUrl(s);
  if (!u) return bad('that isn\'t an X handle or an x.com or linkedin.com address');
  const host = u.hostname.toLowerCase(), parts = segments(u);
  if (X_HOSTS.has(host)) {
    if (parts.length !== 1) return bad('use the account\'s own page, like https://x.com/name');
    return xAccount(parts[0]);
  }
  if (LI_HOSTS.has(host)) {
    if (parts.length < 2 || parts.length > 3 || !LI_KINDS.includes(parts[0]) || (parts[2] && parts[2] !== 'posts')) return bad('use a company or profile page, like https://www.linkedin.com/company/name/');
    if (!LI_SLUG_RE.test(parts[1])) return bad('that LinkedIn address has characters it can\'t use');
    return { ok: true, platform: 'linkedin', handle: `${parts[0]}/${parts[1]}`, url: `https://www.linkedin.com/${parts[0]}/${parts[1]}/` };
  }
  return bad('only x.com and linkedin.com accounts can be watched');
}

// r/name, name, or a reddit.com/r/name address. The feed is always the subreddit's public .rss.
export function parseSubreddit(raw) {
  const s = String(raw ?? '').trim();
  let sub = (s.match(/^\/?(?:r\/)?([A-Za-z0-9_]{2,21})\/?$/) || [])[1];
  if (!sub) {
    const u = asUrl(s);
    if (!u || !REDDIT_HOSTS.has(u.hostname.toLowerCase())) return bad('paste a subreddit like r/name or a reddit.com/r/name address');
    const p = segments(u);
    const rest = p.slice(2).filter((x) => x !== '.rss');
    if (p[0] !== 'r' || !p[1] || rest.length > 1 || (rest[0] && !['new', 'hot', 'top', 'rising'].includes(rest[0]))) return bad('use the subreddit\'s own address, like https://www.reddit.com/r/name/');
    sub = p[1];
  }
  if (!SUB_RE.test(sub)) return bad('that isn\'t a subreddit name');
  return { ok: true, sub, name: `r/${sub}`, url: `https://www.reddit.com/r/${sub}/.rss` };
}

// A saved search: a few plain words, no address and nothing instruction-shaped.
export function parseSearch(raw) {
  const q = oneLine(raw).slice(0, 200);
  if (q.length < 2 || q.length > 80) return bad('a saved search is 2 to 80 characters');
  if (/https?:\/\/|\bwww\.\S/i.test(q)) return bad('a search is a few words, not an address; add a website under Website instead');
  if (instructionPhrase(q)) return bad('that reads like an instruction, not a search');
  return { ok: true, q };
}

// Source keys, as stored on items: they tie a story (and the verdicts on it) back to its source.
export const feedKey = (f) => (f.kind === 'reddit' ? `reddit:${f.sub}` : `rss:${f.name}`);
export const watchKey = (w) => `watch:${w.platform}:${w.handle}`;
export const searchKey = (s) => `search:${s.q}`;
export const TRENDS_KEY = 'trends:x';
export const TRENDS_URL = 'https://x.com/explore/tabs/trending';

// A source she or Claude wants to add, in canonical form, without fetching anything.
// kind: site | reddit | watch | trends | search.
export function normaliseTarget(t = {}) {
  const kind = t.kind || 'site';
  if (kind === 'site') {
    let u;
    try { u = new URL(String(t.url ?? '').trim()); } catch { return bad('that isn\'t a web address'); }
    if (u.protocol !== 'https:') return bad('it must start with https://');
    const list = t.list === 'reading' ? 'reading' : 'feeds';
    return { ok: true, target: { kind, url: u.toString(), list }, label: `${list === 'reading' ? 'Slow reading' : 'Daily news'}: ${u.hostname.replace(/^www\./, '')}`, key: `site:${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}` };
  }
  if (kind === 'reddit') { const r = parseSubreddit(t.sub || t.url); return r.ok ? { ok: true, target: { kind, sub: r.sub }, label: `Subreddit ${r.name}`, key: `reddit:${r.sub.toLowerCase()}` } : r; }
  if (kind === 'watch') { const w = parseWatch(t.url || t.handle); return w.ok ? { ok: true, target: { kind, url: w.url }, label: `Watch ${w.handle} on ${w.platform === 'x' ? 'X' : 'LinkedIn'}`, key: `watch:${w.url.toLowerCase()}` } : w; }
  if (kind === 'trends') return { ok: true, target: { kind, platform: 'x' }, label: 'Trending topics on X', key: TRENDS_KEY };
  if (kind === 'search') { const s = parseSearch(t.q); return s.ok ? { ok: true, target: { kind, q: s.q }, label: `Saved search: ${s.q}`, key: `search:${s.q.toLowerCase()}` } : s; }
  return bad('kind must be site, reddit, watch, trends or search');
}
