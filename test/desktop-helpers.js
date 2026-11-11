// Fakes for the desktop app tests: Electron's safeStorage, the Anthropic API (answers each
// brief and records the request), and a brand with one feed.
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, rss, at, setSources } from './helpers.js';
import { makeHost } from '../desktop/host.js';
import { makeModel, SCHEMAS } from '../desktop/llm.js';
import { callTool } from '../server/lib/tools.js';

export const KEY = 'sk-ant-api03-TESTKEY_abcdefghijklmnopqrstuvwxyz0123456789-WXYZ';

// Stands in for Electron's safeStorage: reversible, and the output never contains the input.
export function fakeSafeStorage({ available = true } = {}) {
  const mask = (b) => Buffer.from(b.map((x) => x ^ 0x5a));
  return {
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (s) => Buffer.concat([Buffer.from('v10'), mask(Buffer.from(s, 'utf8'))]),
    decryptStringAsync: async (b) => ({ result: mask(b.subarray(3)).toString('utf8'), shouldReEncrypt: false }),
  };
}

// Every byte under a folder, as one string, to search for the key.
export function everything(dir) {
  let out = '';
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else out += fs.readFileSync(p).toString('latin1') + '\n'; } };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

const FEED = 'https://feeds.example.com/cycling.xml';
export const NOW = at(2026, 10, 21, 7, 0);
const pub = new Date(NOW - 3600e3).toUTCString();
const stories = [
  ['Riverside adds protected lanes on the bridge road', 'The council finished 4 km of protected lanes.'],
  ['Repair cafes report a rise in bicycle visits', 'Volunteer fixers say autumn is their busiest season.'],
];
const feeds = { [FEED]: rss(stories.map(([title, desc], i) => ({ title, desc, link: `https://news.example.com/${i}`, date: pub }))) };
export const fetchImpl = async (url) => (url in feeds ? { ok: true, status: 200, url, headers: new Map(), text: async () => feeds[url] } : { ok: false, status: 404, headers: new Map(), text: async () => '' });

const LINES = ['Lanes beat paint every time.', 'Ask any courier where the hills are.', 'Good roads make good habits.'];

// Answers like Claude would, by which schema the request asks for. counts: how many takes each
// takes request gets back, in order (after that, all three).
export function fakeApi({ counts = [] } = {}) {
  const requests = [];
  let n = 0;
  const create = async (p) => {
    requests.push(p);
    const schema = p.output_config.format.schema;
    const task = p.messages[0].content.at(-1).text;
    let out;
    if (schema === SCHEMAS.triage) {
      const count = Number(task.match(/# Triage \((\d+) items?\)/)[1]);
      out = { reactions: [...Array(count)].map((_, i) => ({ item: i + 1, thought: 'worth a look', interest: 9, topic: 'infrastructure' })) };
    } else if (schema === SCHEMAS.takes) {
      n++;
      const lines = [...LINES, ...LINES].slice(0, counts[n - 1] ?? LINES.length);
      out = { takes: lines.map((l, i) => ({ text: `${l} Story ${n}.${i >= LINES.length ? ' Again.' : ''}`, thinking: 'honest first reaction', topic: 'infrastructure', cites: [] })) };
    } else throw new Error('unexpected schema');
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] };
  };
  return { requests, create };
}

export async function app({ createModel, counts } = {}) {
  const home = tempHome(), appDir = tempHome();
  const api = fakeApi({ counts });
  const events = [];
  const clock = { t: NOW };
  const host = makeHost({ home, appDir, safeStorage: fakeSafeStorage(), now: () => clock.t, fetchImpl, emit: (e) => events.push(e), createModel: createModel || (() => makeModel({ create: api.create })) });
  return { host, home, appDir, api, events, clock };
}

export async function setUpBrand(host) {
  const ctx = host.ctx;
  const cfg = (file, content) => callTool(ctx, 'studio_config', { action: 'set', file, content });
  await cfg('beat.json', { topics: ['infrastructure', 'repair'], on_beat: ['city cycling'], off_limits: [] });
  setSources(ctx, { feeds: [{ name: 'Example Cycling News', url: FEED, topic: 'infrastructure' }] });
  await cfg('voice.md', '# Voice\nWarm, practical, a little dry.');
  await callTool(ctx, 'studio_config', { action: 'patch', patch: { brand: 'Northwind Bicycles', setup_complete: true, evergreen_per_day: 0 } });
}
