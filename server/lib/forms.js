// Observed form of a post, computed from its text (not from the shape that was asked for),
// and the overuse counters: template forms, 3-word openers, crutch phrase families.
import { defaults } from './config.js';
import { words } from './text.js';

export function compileTemplates(templates = defaults('variety').templates) {
  return Object.entries(templates).map(([name, src]) => ({ name, re: new RegExp(src, 'im') }));
}

const lines = (t) => String(t).split('\n').map((l) => l.trim()).filter(Boolean);

// Returns the single observed form name.
export function formOf(text, templates = compileTemplates()) {
  const t = String(text || '');
  const letters = t.replace(/[^\p{L}]/gu, '');
  const upper = t.replace(/[^\p{Lu}]/gu, '');
  if (letters.length >= 8 && upper.length / letters.length > 0.7) return 'caps';
  const ls = lines(t);
  if (ls.filter((l) => /^[\p{L}][\p{L} ]{0,24}:\s+\S/u.test(l)).length >= 2) return 'script';
  if (/\b\d{1,2}\s*\/\s*10\b/.test(t)) return 'rating';
  for (const { name, re } of templates) if (re.test(t)) return name;
  if (ls.filter((l) => /^([-•*–]|\d+[.)])\s+/.test(l)).length >= 3) return 'list';
  const w = words(t).length;
  if (w <= 2) return 'one-word';
  if (t.split(/\n\s*\n/).filter((p) => p.trim()).length >= 3) return 'paragraphs';
  if (ls.length === 2) return 'two-line';
  if (/\?\s*$/.test(t)) return 'question';
  return 'one-liner';
}

export const isTemplateForm = (form, templates = compileTemplates()) => templates.some((t) => t.name === form);

export function opener(text) {
  const w = words(text).slice(0, 3);
  return w.length === 3 ? w.join(' ') : null;
}

export function compileCrutches(settings, variety = defaults('variety')) {
  const fams = Object.entries(variety.crutches).map(([name, c]) => ({ name, cap: c.cap, re: new RegExp(c.pattern, 'i'), note: c.note }));
  const phrases = (settings?.overused_phrases || []).map((p) => String(p).trim()).filter(Boolean);
  if (phrases.length) {
    fams.push({
      name: 'phrases', cap: settings.variety?.phrase_cap ?? 0.04,
      re: new RegExp(`\\b(?:${phrases.map(escapeRe).join('|')})\\b`, 'i'),
      note: '{k} of the last {n} drafts used a phrase on your "we overuse this" list. This one uses none of them.',
    });
  }
  return fams;
}

export const crutchesIn = (text, fams) => fams.filter((f) => f.re.test(text)).map((f) => f.name);

// Overuse over the last `window` drafts. Shares use the full window even when history
// is shorter, so a young studio isn't flagged for its second draft.
export function overuse(history, { window = 50, templateCap = 0.10, openerCap = 0.05, templates = compileTemplates(), crutches = [] } = {}) {
  const recent = history.slice(-window);
  const forms = {}, openers = {}, crutch = {};
  for (const h of recent) {
    const text = h.text || '';
    const f = h.form || formOf(text, templates);
    forms[f] = (forms[f] || 0) + 1;
    const o = opener(text);
    if (o) openers[o] = (openers[o] || 0) + 1;
    for (const c of crutchesIn(text, crutches)) crutch[c] = (crutch[c] || 0) + 1;
  }
  const templateNames = new Set(templates.map((t) => t.name));
  return {
    n: recent.length,
    forms: Object.entries(forms).filter(([f, k]) => templateNames.has(f) && k / window > templateCap).map(([f, k]) => ({ form: f, k })),
    openers: Object.entries(openers).filter(([, k]) => k / window > openerCap).map(([o, k]) => ({ opener: o, k })),
    crutches: crutches.filter((c) => (crutch[c.name] || 0) / window > c.cap).map((c) => ({ name: c.name, k: crutch[c.name], note: c.note.replace('{k}', crutch[c.name]).replace('{n}', recent.length) })),
  };
}

// Variance collapse: in a batch of >=3 first takes, more than `share` in one form.
export function collapsed(batchForms, share = 0.6) {
  if (batchForms.length < 3) return null;
  const counts = {};
  for (const f of batchForms) counts[f] = (counts[f] || 0) + 1;
  const [form, k] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return k / batchForms.length > share ? form : null;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
