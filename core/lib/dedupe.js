// Item dedupe: exact URL (normalised) plus story-level clustering, so the same story
// from two outlets is triaged and drafted once. Other outlets count as "also covered by".
import { normaliseUrl } from './urls.js';
import { contentWords } from './text.js';

export const STORY_WINDOW_HOURS = 72;
export const JACCARD_MIN = 0.5;
export const CONTAIN_MIN = 0.8;

// "Big Story Happens - The Daily Outlet" -> "big story happens"
export function normaliseTitle(title) {
  let t = String(title || '').toLowerCase();
  t = t.replace(/\s+[-–—|:]\s+[^-–—|:]{2,40}$/, ''); // trailing " - Outlet"
  t = t.replace(/[“”"‘’'`]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export function titleTokens(title) {
  return new Set(contentWords(normaliseTitle(title)).map(stem));
}

const stem = (w) => w.replace(/(?:ing|ed|es|s)$/, '') || w;

export function titleSimilarity(a, b) {
  const A = titleTokens(a), B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const jacc = inter / (A.size + B.size - inter);
  const small = Math.min(A.size, B.size);
  const contain = small >= 4 ? inter / small : 0;
  return Math.max(jacc, contain >= CONTAIN_MIN ? contain : 0);
}

export function sameStory(a, b) {
  if (normaliseTitle(a.title) === normaliseTitle(b.title)) return true;
  return titleSimilarity(a.title, b.title) >= JACCARD_MIN;
}

// Add fresh parsed items to the existing list. Returns {added, dupes, clustered}.
// Mutates `existing` (appends) and assigns story ids. `nextId()` mints item ids.
// A post read from a social page may have no link of its own; it dedupes on `dedupe_key` instead.
const keyOf = (i) => i.dedupe_key || normaliseUrl(i.url);

export function mergeItems(existing, fresh, { now = Date.now(), nextId }) {
  const byUrl = new Set(existing.map(keyOf));
  const windowStart = now - STORY_WINDOW_HOURS * 3600e3;
  const recent = existing.filter((i) => Date.parse(i.fetched_at) >= windowStart && !i.explore);
  let added = 0, dupes = 0, clustered = 0;
  for (const f of fresh) {
    const key = keyOf(f);
    if (byUrl.has(key)) { dupes++; continue; }
    byUrl.add(key);
    const id = nextId();
    const item = { id, ...f, url: f.url, fetched_at: new Date(now).toISOString() };
    const twin = f.explore ? null : recent.find((r) => sameStory(r, item));
    if (twin) {
      item.story = twin.story ?? twin.id;
      item.duplicate_of = twin.story ?? twin.id;
      const rep = existing.find((r) => r.id === item.story);
      if (rep && rep.source !== item.source) rep.also = [...new Set([...(rep.also || []), item.source])];
      clustered++;
    } else {
      item.story = id;
    }
    existing.push(item);
    if (!f.explore) recent.push(item);
    added++;
  }
  return { added, dupes, clustered };
}
