// Seedable RNG (mulberry32) so every random choice is reproducible in tests.

export function makeRng(seed = Date.now()) {
  let a = hashSeed(seed) >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

function hashSeed(seed) {
  if (typeof seed === 'number') return seed;
  let h = 2166136261;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h;
}

// Weighted pick from [{w, ...}] (or with a weight accessor). Returns null on an empty list.
export function weightedPick(rng, items, weightOf = (x) => x.w) {
  const ws = items.map((x) => Math.max(0, weightOf(x)));
  const total = ws.reduce((a, b) => a + b, 0);
  if (!items.length) return null;
  if (total <= 0) return rng.pick(items);
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}
