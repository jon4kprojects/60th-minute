// Seeded RNG so the Daily Challenge is identical for everyone, computed
// locally with no server. Seed from a date string and everyone gets the
// same questions offline.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const seedFrom = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
export const pick    = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
export const shuffle = (rnd, arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
export const sample = (rnd, arr, n) => shuffle(rnd, arr).slice(0, n);

// Fame-weighted pick. Uniform sampling over the pool makes most questions
// deep cuts, because there are far more moderately-known players than
// household names. Weighting by fame^2 keeps the game recognisable while
// still letting less obvious players through.
export const weightedPick = (rnd, arr, w = (x) => x.fame || 1) => {
  let total = 0;
  for (const x of arr) total += w(x);
  let r = rnd() * total;
  for (const x of arr) { r -= w(x); if (r <= 0) return x; }
  return arr[arr.length - 1];
};
export const FAME_W = (p) => Math.pow(Math.max(p.fame - 40, 1), 2);

// Draw n distinct items with the same weighting.
export const weightedSample = (rnd, arr, n, w = FAME_W) => {
  const out = [], used = new Set();
  for (let i = 0; i < n * 30 && out.length < n; i++) {
    const x = weightedPick(rnd, arr, w);
    if (used.has(x.id)) continue;
    used.add(x.id); out.push(x);
  }
  return out;
};
