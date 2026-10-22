// Lint flags: never block on their own, but each one costs x0.85 in rank and shows on the card.
// The "names a person" check is the real private-individual guard: any personal name that
// isn't in the source item or on the allowlist gets a redraft request, then a flag.
import { defaults } from './config.js';
import { normSpace } from './text.js';

const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/u;
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/i;
const HANDLE_RE = /(^|[^\w@.])@[A-Za-z0-9_]{2,}/;
const QUOTE_RE = /["“]([^"”\n]{3,300})["”]/g;
const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const LIST_MARK_RE = /^\s*\d+[.)]\s+/gm;
const NAME_RE = /\b[\p{Lu}][\p{Ll}'’-]+(?:\s+(?:de |van |von |da |di |le |la )?[\p{Lu}][\p{Ll}'’-]+){1,2}\b/gu;
const TITLED_RE = /\b(?:Mr|Mrs|Ms|Mx|Dr|Prof)\.?\s+[\p{Lu}][\p{Ll}'’-]+/gu;

const norm = (s) => normSpace(String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"'));

export function numbersIn(text) {
  return (String(text).replace(LIST_MARK_RE, '').match(NUM_RE) || []).map((n) => n.replace(/,/g, '')).filter((n) => n !== '');
}

export function quotesIn(text) {
  return [...String(text).matchAll(QUOTE_RE)].map((m) => m[1].trim()).filter((q) => q.split(/\s+/).length >= 3);
}

// Candidate personal names: 2-3 capitalised words, minus sentence-start/common words, plus "Dr. X".
export function nameCandidates(text, stop = new Set(defaults('lint').name_stopwords)) {
  const out = new Set();
  for (const m of String(text).matchAll(NAME_RE)) {
    let parts = m[0].split(/\s+/);
    while (parts.length && stop.has(parts[0].replace(/['’]s$/, ''))) parts = parts.slice(1);
    if (parts.length < 2 || parts.some((p) => stop.has(p.replace(/['’]s$/, '')))) continue;
    out.add(parts.join(' ').replace(/['’]s$/, ''));
  }
  for (const m of String(text).matchAll(TITLED_RE)) out.add(m[0]);
  return [...out];
}

export function unknownNames(text, { sourceText = '', allowNames = [], brand = '' } = {}) {
  const src = norm(sourceText);
  const allow = [...allowNames, brand].filter(Boolean).map(norm);
  return nameCandidates(text).filter((n) => {
    const k = norm(n);
    if (src.includes(k)) return false;
    return !allow.some((a) => a.includes(k) || k.includes(a));
  });
}

// lint(text, ctx) -> [{code, label}]
export function lint(text, { sourceText = '', platform = {}, allowNames = [], brand = '', cited = true, lintCfg = defaults('lint') } = {}) {
  const t = String(text || '');
  const lower = norm(t);
  const flags = [];
  const add = (code, label) => flags.push({ code, label });
  const hashtags = (t.match(new RegExp(HASHTAG_RE, 'gu')) || []).length;
  if (hashtags > (platform.hashtags_max ?? 0)) add('hashtag', 'has a hashtag');
  if (URL_RE.test(t)) add('url', 'link in the text');
  if (platform.long_over && t.length > platform.long_over) add('long', `long for ${platform.name || 'this platform'} (${t.length} chars)`);
  if (lintCfg.tie_back.some((w) => lower.includes(w))) add('tie-back', 'ties back to an earlier post');
  if (lintCfg.news_words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(t))) add('news-voice', 'reads like a news report');
  if (HANDLE_RE.test(t)) add('handle', 'mentions an @handle');

  const nums = numbersIn(t);
  const quotes = quotesIn(t);
  if (!cited) {
    if (nums.length) add('stat-uncited', 'a statistic with nothing cited');
    if (quotes.length) add('quote-uncited', 'a quotation with nothing cited');
    const names = unknownNames(t, { allowNames, brand });
    if (names.length) add('name-uncited', `names ${names[0]} with nothing cited`);
    return flags;
  }
  const srcNums = new Set(numbersIn(sourceText));
  const missing = nums.filter((n) => !srcNums.has(n));
  if (missing.length) add('number', `number not in source (${missing.slice(0, 3).join(', ')})`);
  const src = norm(sourceText);
  const badQuote = quotes.find((q) => !src.includes(norm(q)));
  if (badQuote) add('quote', 'quote not in source');
  const who = unknownNames(t, { sourceText, allowNames, brand });
  if (who.length) add('person', `names ${who[0]}, who isn't in the source: check it isn't a private person`);
  return flags;
}

// Copy check: shares a run of `n` words with any shown example.
export function copiesExample(text, examples, n = 5) {
  const grams = (s) => {
    const w = norm(s).replace(/[^\p{L}\p{N}' ]/gu, ' ').split(/\s+/).filter(Boolean);
    const out = new Set();
    for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
    return out;
  };
  const mine = grams(text);
  if (!mine.size) return null;
  for (const ex of examples) {
    for (const g of grams(ex)) if (mine.has(g)) return g;
  }
  return null;
}
