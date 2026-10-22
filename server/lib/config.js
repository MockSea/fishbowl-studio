// Loading and validating the files in the data folder, plus the plugin's own data
// (platforms/, shapes/, defaults/). Platforms and shapes are data: a new one is one file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeHttpsUrl, normaliseUrl } from './urls.js';
import { instructionPhrase } from './fence.js';
import { oneLine } from './text.js';
import { FETCH_KEYS } from './schedule.js';
import { parseSubreddit, parseWatch, parseSearch, feedKey, watchKey, searchKey, TRENDS_KEY } from './handles.js';
import { canRead } from './accounts.js';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const dirJson = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  .map((f) => readJson(path.join(dir, f)));

const cache = {};
function once(key, fn) { return cache[key] ??= fn(); }

export const defaults = (name) => once(`d:${name}`, () => readJson(path.join(PLUGIN_ROOT, 'defaults', `${name}.json`)));
export const allPlatforms = () => once('platforms', () => Object.fromEntries(dirJson(path.join(PLUGIN_ROOT, 'platforms')).map((p) => [p.id, p])));
export const seedShapes = () => once('shapes', () => dirJson(path.join(PLUGIN_ROOT, 'shapes')));

export const SLUG_RE = /^[a-z][a-z0-9_-]{0,39}$/;

export function loadSettings(store) {
  const d = defaults('settings');
  const user = parseJson(store.readFile('settings.json'), {});
  const out = { ...d, ...user };
  for (const k of ['platforms', 'wander', 'variety', 'weights']) out[k] = { ...d[k], ...(user[k] || {}) };
  return out;
}

export function enabledPlatforms(settings) {
  const all = allPlatforms();
  return Object.entries(settings.platforms || {})
    .filter(([id, p]) => p && p.enabled && all[id])
    .map(([id, p]) => ({ ...all[id], share: p.share ?? 1 }));
}

export function loadShapes(store) {
  const learned = parseJson(store.readFile('shapes.json'), { added: [], retired: [] });
  const retired = new Set(learned.retired || []);
  return [...seedShapes(), ...(learned.added || [])].filter((s) => !retired.has(s.id));
}

export function loadBeat(store) {
  const b = parseJson(store.readFile('beat.json'), {});
  return { topics: [], weights: {}, on_beat: [], off_limits: [], curiosity: {}, allow_names: [], ...b };
}

export const topicsOf = (beat) => [...new Set([...(beat.topics || []), 'other'])];
// 1 less, 2 normal, 3 more.
export const topicWeight = (beat, topic) => beat.weights?.[topic] ?? 2;

export function loadSources(store) {
  const s = parseJson(store.readFile('sources.json'), {});
  return { feeds: [], reading: [], watch: [], trends: [], searches: [], aggregator_hosts: [], ...s };
}

// Everything the studio would fetch or read, by a stable key: feed and page addresses, watched
// accounts, trends, saved searches. Used to tell a new fetch target from an edit to an old one.
export function fetchTargets(src) {
  return new Set([
    ...[...(src.feeds || []), ...(src.reading || [])].map((f) => (f.kind === 'reddit' ? feedKey(f) : `url:${normaliseUrl(f.url)}`)),
    ...(src.watch || []).map(watchKey),
    ...(src.trends || []).map(() => TRENDS_KEY),
    ...(src.searches || []).map(searchKey),
  ].map((k) => k.toLowerCase()));
}

export function loadPositions(store) {
  return parseJson(store.readFile('positions.json'), { positions: [] }).positions || [];
}

export function loadAudience(store) {
  const a = parseJson(store.readFile('audience.json'), {});
  return { who: a.who || [], buttons: a.buttons || [] };
}

export function loadVoice(store) {
  return {
    text: store.readFile('voice.md', '') || '',
    samples: (parseJson(store.readFile('voice-samples.json'), { samples: [] }).samples || []),
  };
}

export function loadPlaybook(store) {
  return parseBullets(store.readFile('playbook.md', '') || '');
}

export function parseBullets(md) {
  return md.split('\n').map((l) => l.match(/^\s*[-*]\s+(.*\S)\s*$/)).filter(Boolean).map((m) => m[1]);
}

export function writePlaybook(store, bullets) {
  store.writeFile('playbook.md', `# Playbook\n\nWhat's been working. Accepted by you; Claude only proposes changes.\n\n${bullets.map((b) => `- ${b}`).join('\n')}\n`);
}

export function parseJson(text, fallback) {
  if (text == null || text === '') return fallback;
  try { return JSON.parse(text); } catch { throw new Error('A settings file in the studio folder is not valid JSON. Ask Claude to repair it.'); }
}

// ---- validation for files written through studio_config ----

const CONFIG_FILES = ['settings.json', 'voice.md', 'voice-samples.json', 'beat.json', 'sources.json', 'positions.json', 'audience.json', 'playbook.md'];
export const configFiles = () => [...CONFIG_FILES];

export function validateConfig(file, value) {
  const v = validators[file];
  if (!v) throw new Error(`Unknown file ${file}. Editable files: ${CONFIG_FILES.join(', ')}`);
  return v(value);
}

const isStr = (x, max = 2000) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;

// Voice, playbook, positions and audience reach every brief as their settings, so they must read as
// a description of the brand, not as orders. Same check the proposals go through.
function describes(file, text) {
  const hit = instructionPhrase(text);
  if (hit) throw new Error(`${file} was not saved: "${hit}" reads like an instruction to Claude. Describe the brand instead (e.g. "short, plain sentences" rather than "always write short sentences").`);
  return text;
}

const validators = {
  'voice.md': (t) => { if (!isStr(t, 20000)) throw new Error('voice.md must be non-empty text under 20k characters'); return describes('voice.md', t); },
  'playbook.md': (t) => { if (typeof t !== 'string' || t.length > 8000) throw new Error('playbook.md must be text under 8k characters'); return describes('playbook.md', t); },
  'voice-samples.json': (o) => {
    const samples = (o.samples || []).filter((s) => isStr(s.text, 4000)).slice(0, 20);
    return { samples: samples.map((s) => ({ text: s.text, platform: s.platform || null })) };
  },
  'settings.json': (o) => {
    const d = defaults('settings');
    const out = {};
    for (const [k, val] of Object.entries(o || {})) {
      if (!(k in d)) throw new Error(`Unknown setting: ${k}`);
      out[k] = val;
    }
    if (out.release_hours) {
      const hs = out.release_hours;
      if (!Array.isArray(hs) || !hs.length || hs.length > 8 || hs.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) throw new Error('release_hours must be 1-8 whole hours between 0 and 23');
      out.release_hours = [...new Set(hs)].sort((a, b) => a - b);
    }
    if ('daily_cap' in out && !(Number.isInteger(out.daily_cap) && out.daily_cap >= 1 && out.daily_cap <= 50)) throw new Error('daily_cap must be 1-50');
    if ('held_max_hours' in out && !(out.held_max_hours >= 1 && out.held_max_hours <= 48)) throw new Error('held_max_hours must be 1-48');
    if ('takes_per_item' in out && ![1, 2, 3].includes(out.takes_per_item)) throw new Error('takes_per_item must be 1, 2 or 3');
    if ('evergreen_per_day' in out && !(Number.isInteger(out.evergreen_per_day) && out.evergreen_per_day >= 0 && out.evergreen_per_day <= 6)) throw new Error('evergreen_per_day must be 0-6');
    if ('fetch_every' in out && !FETCH_KEYS.includes(out.fetch_every)) throw new Error(`fetch_every must be one of: ${FETCH_KEYS.join(', ')}`);
    if ('brand' in out) out.brand = oneLine(out.brand).slice(0, 60);
    if (out.platforms) {
      for (const id of Object.keys(out.platforms)) if (!allPlatforms()[id]) throw new Error(`Unknown platform ${id}. Known: ${Object.keys(allPlatforms()).join(', ')}`);
    }
    if (out.overused_phrases && (!Array.isArray(out.overused_phrases) || out.overused_phrases.length > 60)) throw new Error('overused_phrases must be a list of up to 60 phrases');
    if (out.overused_phrases) out.overused_phrases = out.overused_phrases.map((x) => oneLine(x).slice(0, 80)).filter(Boolean);
    return out;
  },
  'beat.json': (o) => {
    const topics = (o.topics || []).map(String);
    for (const t of topics) if (!SLUG_RE.test(t)) throw new Error(`Topic "${t}" must be a lowercase slug like "urban-cycling"`);
    if (topics.length > 30) throw new Error('At most 30 topics');
    const curiosity = {};
    for (const [t, kws] of Object.entries(o.curiosity || {})) curiosity[t] = (kws || []).map(String).slice(0, 20);
    // Topic weight: 1 less, 2 normal (not stored), 3 more. Only for topics on the list.
    const weights = {};
    for (const [t, w] of Object.entries(o.weights || {})) {
      if (!topics.includes(t)) continue;
      if (![1, 2, 3].includes(w)) throw new Error(`Topic "${t}": weight must be 1 (less), 2 (normal) or 3 (more)`);
      if (w !== 2) weights[t] = w;
    }
    return {
      about: typeof o.about === 'string' ? o.about.slice(0, 2000) : '',
      topics, weights,
      on_beat: (o.on_beat || []).map(String).slice(0, 40),
      off_limits: (o.off_limits || []).map(String).slice(0, 40),
      curiosity,
      allow_names: (o.allow_names || []).map(String).slice(0, 200),
    };
  },
  'sources.json': (o) => {
    const topicOf = (t, who) => { if (t && !SLUG_RE.test(t)) throw new Error(`${who}: topic must be a slug`); return t || 'other'; };
    const paused = (x) => (x.paused === true ? { paused: true } : {});
    const feed = (list) => (f, i) => {
      // A subreddit is a feed whose address is always built from its name (its public .rss).
      if (f.kind === 'reddit') {
        if (list !== 'feeds') throw new Error('Subreddits go on the daily news list');
        const r = parseSubreddit(f.sub || f.url);
        if (!r.ok) throw new Error(`Source "${f.name || i + 1}": ${r.reason}`);
        return { kind: 'reddit', sub: r.sub, name: isStr(f.name, 80) ? oneLine(f.name) : r.name, url: r.url, topic: topicOf(f.topic, r.name), limit: clampInt(f.limit, 1, 40, 12), ...paused(f) };
      }
      if (!isStr(f.name, 80)) throw new Error(`Source ${i + 1} needs a name`);
      const u = safeHttpsUrl(f.url);
      if (!u.ok) throw new Error(`Source "${f.name}": ${u.reason}`);
      return { name: oneLine(f.name), url: u.url, topic: topicOf(f.topic, `Source "${f.name}"`), limit: clampInt(f.limit, 1, 40, 12), ...paused(f) };
    };
    const feeds = (o.feeds || []).map(feed('feeds'));
    const reading = (o.reading || []).map(feed('reading'));
    if (feeds.length > 90 || reading.length > 90) throw new Error('At most 90 feeds and 90 reading-list sources');
    // Accounts read logged out on their public page. `via` names how: "public" today; a signed-in
    // read through an account slot ("account:<type>") is allowed only once that type can read.
    const watch = (o.watch || []).map((w, i) => {
      const p = parseWatch(w.url || w.handle);
      if (!p.ok) throw new Error(`Watched account ${i + 1}: ${p.reason}`);
      const via = w.via == null || w.via === 'public' ? 'public' : String(w.via);
      if (via !== 'public' && !(/^account:[a-z][a-z0-9-]{0,29}$/.test(via) && canRead(via.slice(8)))) throw new Error(`Watched account ${p.handle}: no connected account can read yet, so it is read logged out ("via": "public")`);
      return { platform: p.platform, handle: p.handle, url: p.url, name: isStr(w.name, 80) ? oneLine(w.name) : p.handle, topic: topicOf(w.topic, p.handle), via, ...paused(w) };
    });
    if (watch.length > 30) throw new Error('At most 30 watched accounts');
    if (new Set(watch.map((w) => w.url.toLowerCase())).size !== watch.length) throw new Error('That account is already on the watch list');
    const trends = (o.trends || []).map((t) => {
      if ((t.platform || 'x') !== 'x') throw new Error('Trending topics come from X only');
      return { platform: 'x', name: 'Trending on X', topic: topicOf(t.topic, 'Trending on X'), ...paused(t) };
    });
    if (trends.length > 1) throw new Error('X trending topics is on the list once');
    const searches = (o.searches || []).map((s, i) => {
      const p = parseSearch(s.q);
      if (!p.ok) throw new Error(`Saved search ${i + 1}: ${p.reason}`);
      return { q: p.q, topic: topicOf(s.topic, `Search "${p.q}"`), ...paused(s) };
    });
    if (searches.length > 20) throw new Error('At most 20 saved searches');
    if (new Set(searches.map((s) => s.q.toLowerCase())).size !== searches.length) throw new Error('That search is already saved');
    return { feeds, reading, watch, trends, searches, aggregator_hosts: (o.aggregator_hosts || []).map((h) => String(h).toLowerCase()).slice(0, 20) };
  },
  'positions.json': (o) => {
    const positions = (o.positions || []).map((p) => {
      if (!isStr(p.text, 300)) throw new Error('Each position needs text under 300 characters');
      describes('positions.json', p.text);
      return { text: p.text.trim(), strength: clampInt(p.strength, 1, 5, 3) };
    });
    if (positions.length > 30) throw new Error('At most 30 positions');
    return { positions };
  },
  'audience.json': (o) => {
    const row = (r) => { if (!isStr(r.text, 300)) throw new Error('Each audience line needs text'); describes('audience.json', r.text); return { text: r.text.trim(), confidence: clampInt(r.confidence, 1, 5, 1) }; };
    return { who: (o.who || []).map(row).slice(0, 12), buttons: (o.buttons || []).map(row).slice(0, 20) };
  },
};

function clampInt(v, lo, hi, dflt) {
  const n = Number.isFinite(+v) ? Math.round(+v) : dflt;
  return Math.min(hi, Math.max(lo, n));
}
