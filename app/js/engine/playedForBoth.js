// Played for Both — pick sides (clubs, or a country) and name everyone who
// turned out for ALL of them.
//
// Sampling n clubs at random and hoping they intersect does not work: zero
// random 4-club combinations in 60,000 draws shared a single player. So boards
// are built incrementally instead - each club is drawn from those that keep the
// shared set non-empty - which makes any size reachable, and is the same filter
// the hand-picker uses. The most-travelled player in the data turned out for 30
// clubs, so that, not an arbitrary number, is the ceiling.
//
// The count is OUR count, from this dataset, not football's. It is hidden by
// default and offered as a clue, and a guess we cannot place is answered
// honestly rather than flatly marked wrong.
import { pick, shuffle } from '../rng.js';
import { lookup } from '../names.js';
import { shortClub } from '../data.js';

const MIN_ON_BOARD = 5, MAX_ON_BOARD = 20;
// Two different jobs, two different bars.
//
// Dealing at random should produce a board people recognise, so it draws from
// clubs with several well-known players. Hand-picking should not be limited
// that way: Norwich has 67 players in the data and exactly one famous name, and
// was being withheld even though Norwich x West Ham is a 12-player board with
// Bellamy, Parker, Martin Peters and Dean Ashton on it. If you can name the
// club, you should be able to pick it.
const DEAL_PROM = 3;      // well-known players needed to be dealt at random
const PICK_SQUAD = 8;     // players we hold, to be pickable by hand. Low on
                          // purpose: the compatible-club filter already
                          // guarantees a non-empty board, so the only question
                          // is whether we hold enough of a club to be useful.
const NAT_PROM = 10;
const RESERVES = /U-?\d\d|Under-?\d|\bReserves?\b|\bAcademy\b|\bYouth\b|\bII$|\sB$/i;
export const LIVES = 3;

// No fixed cap on hand-picked sides. The data does not impose one - Sebastian
// Abreu alone turned out for 30 clubs - and the compatible-club filter stops
// you naturally when nothing shares a player. What DOES bite is board size:
// 14 hand-picked clubs produce 533 names, which nobody clears. So the app
// warns rather than forbids, and the choice stays yours.
export const BIG_BOARD = 40;

// Dealt boards are capped by playability, not by club count: past six clubs
// the board reliably exceeds MAX_ON_BOARD and cannot be dealt at all.
export const MAX_DEAL = 6;

/** Clubs recognisable enough to appear in a randomly dealt board. */
export const clubChoices = (db) =>
  [...db.clubProm].filter(([c, n]) => n >= DEAL_PROM && !RESERVES.test(c))
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => ({ key: c, label: shortClub(c), kind: 'club' }));

/** Clubs you can choose by hand - a far wider net, sorted alphabetically. */
export const pickableClubs = (db) =>
  [...db.byClub].filter(([c, ids]) => ids.size >= PICK_SQUAD && !RESERVES.test(c))
    .map(([c]) => ({ key: c, label: shortClub(c), kind: 'club' }))
    .sort((a, b) => a.label.localeCompare(b.label));

export const countryChoices = (db) =>
  [...db.natProm].filter(([, n]) => n >= NAT_PROM)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => ({ key: c, label: c, kind: 'country' }));

/**
 * Clubs that would actually contribute to a board alongside those already
 * chosen — i.e. that share at least one player with them.
 *
 * Offering anything else lets you build a board with nothing on it, which is a
 * dead end you only discover after pressing Start.
 */
/**
 * Candidate next clubs WITH the board size each would leave behind.
 *
 * Growing a board by picking blindly from the compatible set collapses it to a
 * single answer almost every time past three clubs, which made every round the
 * same "guess the one player". Knowing the resulting size lets the generator
 * prefer clubs that keep several in play.
 */
export function nextOptions(db, chosenKeys, pool) {
  const all = pool || clubChoices(db);
  let shared = null;
  for (const k of chosenKeys) {
    const set = db.byClub.get(k) || new Set();
    shared = shared === null ? new Set(set) : new Set([...shared].filter(id => set.has(id)));
    if (!shared.size) return [];
  }
  const out = [];
  for (const c of all) {
    if (chosenKeys.includes(c.key)) continue;
    const set = db.byClub.get(c.key) || new Set();
    let size = 0;
    if (shared === null) size = set.size;
    else for (const id of shared) if (set.has(id)) size++;
    if (size > 0) out.push({ ...c, size });
  }
  return out;
}

export function compatibleClubs(db, chosenKeys, pool) {
  const all = pool || clubChoices(db);
  if (!chosenKeys.length) return all;
  // whoever has played for everything chosen so far
  let shared = null;
  for (const k of chosenKeys) {
    const set = db.byClub.get(k) || new Set();
    shared = shared === null ? new Set(set) : new Set([...shared].filter(id => set.has(id)));
    if (!shared.size) return [];
  }
  return all.filter(c => {
    if (chosenKeys.includes(c.key)) return false;
    const set = db.byClub.get(c.key) || new Set();
    for (const id of shared) if (set.has(id)) return true;   // at least one survives
    return false;
  });
}

const setOf = (db, side) =>
  side.kind === 'country' ? db.byNation.get(side.key) : db.byClub.get(side.key);

/** Players who turned out for EVERY one of the given sides, best known first. */
export function solve(db, sides) {
  if (!sides.length) return [];
  let acc = null;
  for (const s of sides) {
    const set = setOf(db, s) || new Set();
    acc = acc === null ? new Set(set) : new Set([...acc].filter(id => set.has(id)));
    if (!acc.size) return [];
  }
  return [...acc].sort((a, b) => db.byId.get(b).fame - db.byId.get(a).fame);
}

export function build(db, sides) {
  const answerIds = solve(db, sides);
  return { mode: 'played-for-both', sides, answerIds, count: answerIds.length };
}

export function generate(db, rnd, n = 2) {
  // 'any' stays in 2-5: at six clubs every board collapses to a single answer,
  // so a surprise round should not land there.
  if (n === 'any') n = 2 + Math.floor(rnd() * 4);
  const clubs = clubChoices(db);
  const countries = countryChoices(db);
  if (clubs.length < n) return null;

  // Two passes: first insisting the board keeps more than one answer, then
  // accepting a single-answer board if the shape genuinely allows nothing more.
  for (let attempt = 0; attempt < 500; attempt++) {
    const wantPlural = attempt < 400;
    const keys = [pick(rnd, clubs).key];
    let ok = true;
    while (keys.length < n) {
      const opts = nextOptions(db, keys);
      if (!opts.length) { ok = false; break; }
      // prefer clubs that leave several players standing, without always
      // taking the largest - that would deal the same board every time
      const viable = wantPlural ? opts.filter(o => o.size >= 2) : opts;
      const poolOpts = viable.length ? viable : opts;
      const total = poolOpts.reduce((a, o) => a + o.size, 0);
      let r = rnd() * total, chosenOpt = poolOpts[poolOpts.length - 1];
      for (const o of poolOpts) { r -= o.size; if (r <= 0) { chosenOpt = o; break; } }
      keys.push(chosenOpt.key);
    }
    if (!ok) continue;
    if (wantPlural && solve(db, keys.map(k => clubs.find(c => c.key === k))).length < 2) continue;

    let sides = keys.map(k => clubs.find(c => c.key === k));
    if (n === 2 && countries.length && rnd() < 0.25) {
      const alt = [sides[0], pick(rnd, countries)];
      if (solve(db, alt).length >= MIN_ON_BOARD) sides = alt;
    }
    const ids = solve(db, sides);
    if (ids.length >= (n > 2 ? 1 : MIN_ON_BOARD) && ids.length <= MAX_ON_BOARD)
      return { mode: 'played-for-both', sides, answerIds: ids, count: ids.length };
  }
  return null;
}

/**
 * A player's figure for one side of the board, for display.
 * Clubs show appearances; a country side shows caps.
 */
export function figureFor(db, player, side) {
  if (side.kind === 'country') return player.caps ? `${player.caps} caps` : null;
  const t = player.clubTotals && player.clubTotals[side.key];
  if (t && t.apps != null) return `${t.apps}`;
  const sum = player.clubs.filter(c => c.club === side.key)
                          .reduce((a, c) => a + (c.apps || 0), 0);
  return sum ? `${sum}` : null;
}

export function createGame(board) {
  return { board, found: new Set(), lives: LIVES, wrong: [],
           finished: false, gaveUp: false, countShown: false };
}

const sidesFor = (db, p, sides) =>
  sides.filter(s => s.kind === 'country' ? p.nationality === s.key
                                         : (p.allClubs || p.clubs.map(c => c.club)).includes(s.key));

export function guess(db, idx, game, raw) {
  const b = game.board;
  const p = lookup(idx, raw, new Set(b.answerIds));
  if (!p) return { status: 'unknown' };
  if (game.found.has(p.id)) return { status: 'already', player: p };
  if (b.answerIds.includes(p.id)) return { status: 'hit', player: p };
  const on = sidesFor(db, p, b.sides);
  const missing = b.sides.filter(s => !on.includes(s));
  if (on.length) return { status: 'partial', player: p, on, missing };
  return { status: 'none', player: p };
}

export function apply(game, res) {
  if (res.status === 'hit') {
    game.found.add(res.player.id);
    if (game.found.size === game.board.count) game.finished = true;
  } else if (res.status === 'partial' || res.status === 'none') {
    // A name we do not hold is a gap in our data, not a bad guess, so
    // 'unknown' never costs a life.
    game.lives--;
    game.wrong.push(res.player.name);
    if (game.lives <= 0) game.finished = true;
  }
  return game;
}

export const explain = (r) => ({
  unknown:    'No player by that name found',
  already:    `${r.player?.name} is already on the board`,
  hit:        `${r.player?.name} ✓`,
  partial:    `${r.player?.name} played for ${r.on?.map(s => s.label).join(' and ')}, but not `
              + `${r.missing?.map(s => s.label).join(' or ')}`,
  none:       `${r.player?.name} played for none of these`,
}[r.status]);
