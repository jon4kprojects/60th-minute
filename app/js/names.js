// Name matching for typed input.
//
// Deliberately NO autocomplete dropdown in Football 501: the whole game is
// recalling players from memory, and offering a list of the club's squad
// would hand the answer over. So input is free text and this has to be
// forgiving about accents, partial names and phone-keyboard typos.

const norm = (s) => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
  .toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ').trim();

export function buildNameIndex(players) {
  const exact = new Map(), surname = new Map(), all = [];
  for (const p of players) {
    const n = norm(p.name);
    if (!n) continue;
    all.push({ p, n });
    if (!exact.has(n)) exact.set(n, []);
    exact.get(n).push(p);
    const parts = n.split(' ');
    const last = parts[parts.length - 1];
    if (parts.length > 1) {
      if (!surname.has(last)) surname.set(last, []);
      surname.get(last).push(p);
    }
  }
  return { exact, surname, all };
}

const dist = (a, b) => {                       // bounded Levenshtein
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
};

// Candidates are scored rather than taken in priority order: a substring hit
// used to beat a one-character typo, so "scholse" found nothing while "gerard"
// matched Gerard Pique ahead of Steven Gerrard.
//
// `prefer` is the club's roster: on a genuinely ambiguous surname the player
// who actually turned out for this club is the charitable reading.
export function lookup(idx, query, prefer = null) {
  const q = norm(query);
  if (q.length < 3) return null;

  const scored = [];
  for (const { p, n } of idx.all) {
    const parts = n.split(' ');
    const last = parts[parts.length - 1];
    let sc = 0;
    if (n === q) sc = 100;
    else if (last === q) sc = 90;
    else if (parts.length > 1 && parts[0] === q) sc = 72;
    else {
      const d1 = dist(last, q), d2 = dist(n, q);
      const d = Math.min(d1, d2);
      if (d <= 2) sc = 80 - d * 8;                       // typo tolerance
      else if (n.includes(q)) sc = 55 + (q.length / n.length) * 10;
      else if (q.includes(n)) sc = 50;
    }
    if (sc > 0) scored.push({ p, sc });
  }
  if (!scored.length) return null;

  const top = Math.max(...scored.map(x => x.sc));
  const best = scored.filter(x => x.sc === top).map(x => x.p);
  if (best.length === 1) return best[0];
  if (prefer) { const m = best.filter(p => prefer.has(p.id)); if (m.length) return m[0]; }
  return best.slice().sort((a, b) => b.fame - a.fame)[0];
}
