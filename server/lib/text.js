// Small text helpers shared by every module.
import { createHash } from 'node:crypto';

export const STOPWORDS = new Set((
  'a an the and or but if then else of to in on at for with from by as is are was were be been being ' +
  'it its this that these those there here what which who whom whose why how when where i me my we our us ' +
  'you your he she him her his they them their not no yes do does did done have has had having will would ' +
  'can could should may might must shall just so than too very also about into over under after before ' +
  'up down out off again more most some any all each other such only own same both few new says said ' +
  'via per get gets got one two three'
).split(' '));

const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

export function stripControl(s) {
  return String(s ?? '').replace(CONTROL_RE, '');
}

export function clip(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function sha12(s) {
  return createHash('sha256').update(String(s ?? ''), 'utf8').digest('hex').slice(0, 12);
}

export function normSpace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

export function words(s) {
  return String(s ?? '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
}

export function contentWords(s) {
  return words(s).map((w) => w.replace(/['’]s$/, '')).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export function cleanPost(s) {
  return stripControl(s).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// Mid-rank percentile of `x` among `xs` (0..1). A lone value is 0.5.
export function percentile(x, xs) {
  if (!xs.length) return 0.5;
  let below = 0, equal = 0;
  for (const v of xs) { if (v < x) below++; else if (v === x) equal++; }
  return (below + 0.5 * equal) / xs.length;
}

export function hoursBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3600e3;
}

export function localDate(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function localHM(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
