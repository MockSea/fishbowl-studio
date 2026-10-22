// Loading and validating the files in the data folder, plus the plugin's own data
// (platforms/, shapes/, defaults/). Platforms and shapes are data: a new one is one file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeHttpsUrl } from './urls.js';
import { instructionPhrase } from './fence.js';

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
  return { topics: [], on_beat: [], off_limits: [], curiosity: {}, allow_names: [], ...b };
}

export const topicsOf = (beat) => [...new Set([...(beat.topics || []), 'other'])];

export function loadSources(store) {
  const s = parseJson(store.readFile('sources.json'), {});
  return { feeds: [], reading: [], aggregator_hosts: [], ...s };
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

// Voice, playbook, positions and audience reach every brief as her settings, so they must read as
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
    if (out.platforms) {
      for (const id of Object.keys(out.platforms)) if (!allPlatforms()[id]) throw new Error(`Unknown platform ${id}. Known: ${Object.keys(allPlatforms()).join(', ')}`);
    }
    if (out.overused_phrases && (!Array.isArray(out.overused_phrases) || out.overused_phrases.length > 60)) throw new Error('overused_phrases must be a list of up to 60 phrases');
    return out;
  },
  'beat.json': (o) => {
    const topics = (o.topics || []).map(String);
    for (const t of topics) if (!SLUG_RE.test(t)) throw new Error(`Topic "${t}" must be a lowercase slug like "urban-cycling"`);
    if (topics.length > 30) throw new Error('At most 30 topics');
    const curiosity = {};
    for (const [t, kws] of Object.entries(o.curiosity || {})) curiosity[t] = (kws || []).map(String).slice(0, 20);
    return {
      about: typeof o.about === 'string' ? o.about.slice(0, 2000) : '',
      topics,
      on_beat: (o.on_beat || []).map(String).slice(0, 40),
      off_limits: (o.off_limits || []).map(String).slice(0, 40),
      curiosity,
      allow_names: (o.allow_names || []).map(String).slice(0, 200),
    };
  },
  'sources.json': (o) => {
    const feed = (f, i) => {
      if (!isStr(f.name, 80)) throw new Error(`Source ${i + 1} needs a name`);
      const u = safeHttpsUrl(f.url);
      if (!u.ok) throw new Error(`Source "${f.name}": ${u.reason}`);
      if (f.topic && !SLUG_RE.test(f.topic)) throw new Error(`Source "${f.name}": topic must be a slug`);
      return { name: f.name.trim(), url: u.url, topic: f.topic || 'other', limit: clampInt(f.limit, 1, 40, 12) };
    };
    const feeds = (o.feeds || []).map(feed);
    const reading = (o.reading || []).map(feed);
    if (feeds.length > 90 || reading.length > 90) throw new Error('At most 90 feeds and 90 reading-list sources');
    return { feeds, reading, aggregator_hosts: (o.aggregator_hosts || []).map((h) => String(h).toLowerCase()).slice(0, 20) };
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
