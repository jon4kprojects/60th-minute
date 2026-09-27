// The Grid: three categories down the side, three across the top, and every
// square wants one player who satisfies both. Nine guesses, and nobody can be
// used twice - the second time you reach for Beckham he is gone.
//
// Every square is checked for answers before the grid is ever shown. A grid
// with an impossible square is worse than no grid at all, and you would only
// find out after nine guesses.
import { shortClub } from '../data.js';
import { pick, shuffle } from '../rng.js';

export const GUESSES = 9;
const MIN_ANSWERS = 3;      // a square with one answer is a lottery, not a question

const ok = (p) => !p.noStats && !p.statsSuspect;

/**
 * The categories a grid can be built from. Each carries the set of players who
 * satisfy it, so building a grid is set intersection rather than a scan.
 *
 * Season-by-season figures are deliberately absent: we hold career and per-club
 * totals, so a category like "10+ league goals in a season" could not be
 * checked, only guessed at.
 */
export function categories(db) {
  const out = [];
  const add = (kind, key, label, ids, sort) => {
    if (ids.size >= 12) out.push({ kind, key, label, ids, sort: sort ?? 0 });
  };

  for (const [club, ids] of db.byClub) {
    if ((db.clubProm.get(club) || 0) >= 8) add('club', 'c:' + club, shortClub(club), ids, db.clubProm.get(club));
  }
  for (const [nat, ids] of db.byNation) {
    if ((db.natProm.get(nat) || 0) >= 8) add('country', 'n:' + nat, nat, ids, db.natProm.get(nat));
  }

  const by = (fn) => new Set(db.players.filter(fn).map(p => p.id));
  for (const pos of ['Goalkeeper', 'Defender', 'Centre-Back', 'Full-Back', 'Midfielder', 'Forward'])
    add('trait', 'p:' + pos, pos, by(p => p.position === pos));

  add('trait', 'caps50',  '50+ caps',  by(p => (p.caps || 0) >= 50));
  add('trait', 'caps100', '100+ caps', by(p => (p.caps || 0) >= 100));
  add('trait', 'g100', '100+ club goals', by(p => ok(p) && (p.careerGoals || 0) >= 100));
  add('trait', 'g200', '200+ club goals', by(p => ok(p) && (p.careerGoals || 0) >= 200));
  add('trait', 'a500', '500+ club games', by(p => ok(p) && (p.careerApps || 0) >= 500));
  add('trait', 'pre90',  'Started before 1990',    by(p => p.debut && p.debut < 1990));
  add('trait', 'post10', 'Started 2010 or later',  by(p => p.debut && p.debut >= 2010));
  return out;
}

const inter = (a, b) => {
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  const r = new Set();
  for (const x of s) if (l.has(x)) r.add(x);
  return r;
};

/** Two club categories for the same club, or a trait and itself, make a dead square. */
const clashes = (a, b) => a.key === b.key ||
  (a.kind === 'trait' && b.kind === 'trait' && a.key[0] === b.key[0] && a.key !== b.key &&
   (inter(a.ids, b.ids).size === Math.min(a.ids.size, b.ids.size)));

export function generate(db, rnd, opts = {}) {
  const cats = opts.cats || categories(db);
  if (cats.length < 6) return null;
  const clubs = cats.filter(c => c.kind === 'club');
  const rest = cats.filter(c => c.kind !== 'club');

  for (let attempt = 0; attempt < 400; attempt++) {
    // Clubs carry a grid - they are what people actually recall players by -
    // so most of the axes are clubs and the rest is seasoning.
    const picks = shuffle(rnd, [
      ...shuffle(rnd, clubs).slice(0, 4),
      ...shuffle(rnd, rest).slice(0, 2),
    ]);
    const rows = picks.slice(0, 3), cols = picks.slice(3, 6);
    if (rows.some(r => cols.some(c => clashes(r, c)))) continue;

    const cells = rows.map(r => cols.map(c => inter(r.ids, c.ids)));
    if (cells.some(row => row.some(s => s.size < MIN_ANSWERS))) continue;
    return {
      rows: rows.map(({ kind, key, label }) => ({ kind, key, label })),
      cols: cols.map(({ kind, key, label }) => ({ kind, key, label })),
      cells,
    };
  }
  return null;
}

export function createGame(grid) {
  return {
    grid,
    filled: [[null, null, null], [null, null, null], [null, null, null]],
    used: new Set(),
    left: GUESSES,
    finished: false,
  };
}

export const filledCount = (g) => g.filled.flat().filter(Boolean).length;

export function submit(db, nameIdx, game, r, c, text, lookup) {
  if (game.finished || game.filled[r][c]) return { status: 'taken' };
  let p = lookup(nameIdx, text);
  if (!p) return { status: 'no-player' };
  const ids = game.grid.cells[r][c];
  // Two men are called Luis Suarez, and the lookup hands back the famous one.
  // If a namesake is the answer to this square, that is plainly who was meant.
  // Exact name only - matching loosely would let a half-typed surname find
  // whoever happened to fit, which is the answer, not a guess at it.
  if (!ids.has(p.id) && !game.used.has(p.id)) {
    const twin = [...ids].map(id => db.byId.get(id))
      .find(o => o && o.name.toLowerCase() === p.name.toLowerCase());
    if (twin) p = twin;
  }
  if (game.used.has(p.id)) return { status: 'used', player: p };
  if (!ids.has(p.id)) return { status: 'wrong', player: p };
  return { status: 'ok', player: p };
}

export function apply(game, res, r, c) {
  if (res.status === 'ok') {
    game.filled[r][c] = { id: res.player.id, name: res.player.name };
    game.used.add(res.player.id);
    game.left--;
  } else if (res.status !== 'taken') {
    game.left--;
  }
  if (game.left <= 0 || filledCount(game) === 9) game.finished = true;
  return game;
}

/**
 * On giving up, one answer for each empty square - and a different player in
 * every square. Picking the best-known name per square independently handed
 * back the same man three times, which is not a set of answers anyone could
 * have played, since nobody can be used twice.
 *
 * Scarcest squares choose first, so a square with four candidates is not left
 * empty by a square with four hundred taking its only well-known name.
 */
export function reveal(db, game) {
  const out = [[null, null, null], [null, null, null], [null, null, null]];
  const taken = new Set(game.used);
  const todo = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    if (!game.filled[r][c]) todo.push({ r, c, ids: game.grid.cells[r][c] });
  todo.sort((a, b) => a.ids.size - b.ids.size);
  for (const { r, c, ids } of todo) {
    let best = null;
    for (const id of ids) {
      if (taken.has(id)) continue;
      const p = db.byId.get(id);
      if (p && (!best || p.fame > best.fame)) best = p;
    }
    if (best) { out[r][c] = best.name; taken.add(best.id); }
  }
  return out;
}

export const explain = (res) => ({
  'no-player': 'No player by that name found',
  used:        `${res.player?.name} has already been used`,
  wrong:       `${res.player?.name} does not fit that square`,
  taken:       'That square is already filled',
  ok:          res.player?.name,
}[res.status]);
