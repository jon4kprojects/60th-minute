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
    // Context bonus: the prompt says "name a Juventus player", so a player who
    // actually turned out for them beats a slightly better string match who did
    // not. Without this, "trezeguet" resolved to the Egyptian winger rather
    // than David Trezeguet, who scored 171 for Juventus.
    if (sc > 0) scored.push({ p, sc: sc + (prefer && prefer.has(p.id) ? 12 : 0) });
  }
  if (!scored.length) return null;

  const top = Math.max(...scored.map(x => x.sc));
  const best = scored.filter(x => x.sc === top).map(x => x.p);
  if (best.length === 1) return best[0];
  if (prefer) { const m = best.filter(p => prefer.has(p.id)); if (m.length) return m[0]; }
  return best.slice().sort((a, b) => b.fame - a.fame)[0];
}

/**
 * Typeahead suggestions.
 *
 * Deliberately matched against the WHOLE player list, never the chosen club's
 * squad. Filtering to the club would turn the dropdown into an answer key —
 * you would type one letter and read the team sheet. Matching globally means
 * it only helps you spell a name you had already thought of.
 */
export function suggest(idx, query, limit = 6) {
  const q = norm(query);
  if (q.length < 2) return [];
  const solid = [], loose = [];
  for (const { p, n } of idx.all) {
    const parts = n.split(' ');
    const last = parts[parts.length - 1];
    let sc = 0;
    // A single token is almost always a surname, so it must outrank a
    // whole-name prefix: "gigi riva" also startsWith("gig"), and used to be
    // offered above Ryan Giggs.
    const multi = q.includes(' ');
    if (n === q) sc = 100;
    else if (last === q) sc = 94;                            // "pirlo" -> Andrea Pirlo
    else if (multi && n.startsWith(q)) sc = 92;              // "ryan gig" -> Ryan Giggs
    else if (last.startsWith(q)) sc = 86;                    // "gig" -> Giggs
    else if (!multi && n.startsWith(q)) sc = 80;             // "gigi" -> Gigi Riva
    else if (parts.some(t => t.startsWith(q))) sc = 76;
    else if (n.includes(q)) sc = 64;
    if (sc) { solid.push({ p, sc }); continue; }
    // Typo tolerance is a fallback only. Applied eagerly it suggests Neto for
    // "nedv" and Kubo for "bufo", which is worse than showing nothing.
    if (q.length >= 4 && Math.min(dist(last, q), dist(n, q)) <= 2) loose.push({ p, sc: 40 });
  }
  const by = (a, b) => (b.sc - a.sc) || (b.p.fame - a.p.fame);
  const out = solid.sort(by);
  if (out.length < limit) out.push(...loose.sort(by).slice(0, limit - out.length));
  return out.slice(0, limit).map(x => x.p);
}
