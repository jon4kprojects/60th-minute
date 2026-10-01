// Country Conundrum — name the nations a club has fielded, on a world map.
//
// A country counts if someone who played for the club represented it at senior
// international level. Nationality is the country a player was capped by, not
// where he was born, and each player counts once: dual nationals would
// otherwise make the same man the answer to two squares of the world.
//
// Only countries the map can actually draw are targets. Yugoslavia, the Soviet
// Union and Czechoslovakia are real football nations and real answers in other
// games, but a modern map has nowhere to put them, so a round built on them
// could not be finished.
import { shortClub } from '../data.js';
import { pick } from '../rng.js';

export const TARGET = 30;

/**
 * Country -> the players who make it count, best known first.
 * Built once per round; every guess after that is a map lookup.
 */
export function answersFor(db, club, placed) {
  const out = new Map();
  const ids = db.byClub.get(club);
  if (!ids) return out;
  for (const id of ids) {
    const p = db.byId.get(id);
    if (!p || !p.nationality || !placed.has(p.nationality)) continue;
    if (!out.has(p.nationality)) out.set(p.nationality, []);
    out.get(p.nationality).push(p);
  }
  for (const [k, list] of out) {
    list.sort((a, b) => (b.fame || 0) - (a.fame || 0));
    out.set(k, list.slice(0, 3).map(p => p.name));
  }
  return out;
}

/** Clubs with enough drawable countries to be worth a round. */
export function clubChoices(db, placed, min = TARGET) {
  const out = [];
  for (const [club, ids] of db.byClub) {
    const seen = new Set();
    for (const id of ids) {
      const p = db.byId.get(id);
      if (p && p.nationality && placed.has(p.nationality)) seen.add(p.nationality);
    }
    if (seen.size >= min)
      out.push({ name: club, label: shortClub(club), n: seen.size,
                 prom: db.clubProm.get(club) || 0 });
  }
  return out.sort((a, b) => b.n - a.n);
}

export function createGame({ club, answers, target = TARGET }) {
  return {
    club, answers,
    // the ask can never exceed what the club actually has
    target: Math.min(target, answers.size),
    found: new Map(),            // country -> players revealed
    wrong: new Set(),
    guesses: 0,
    finished: false,
  };
}

/**
 * A guess at one country. Wrong answers stay wrong for the round and cannot be
 * spent twice - re-tapping a red country must not quietly cost another guess.
 */
export function guess(game, country) {
  if (game.finished) return { status: 'over' };
  if (game.found.has(country)) return { status: 'already', country };
  if (game.wrong.has(country)) return { status: 'already', country };
  game.guesses++;
  const players = game.answers.get(country);
  if (players) {
    game.found.set(country, players);
    if (game.found.size >= game.target) game.finished = true;
    return { status: 'correct', country, players };
  }
  game.wrong.add(country);
  return { status: 'wrong', country };
}

/** Accuracy, as the share of guesses that landed. */
export const accuracy = (game) =>
  game.guesses ? Math.round((game.found.size / game.guesses) * 1000) / 10 : 0;

export const stateOf = (game, country) =>
  game.found.has(country) ? 'found' : game.wrong.has(country) ? 'wrong' : '';

/** A country still unfound, for a nudge when the obvious ones run out. */
export function remaining(game) {
  return [...game.answers.keys()].filter(c => !game.found.has(c));
}

/**
 * Weighted to clubs people know. Every club here has thirty countries, but a
 * round of Amiens asks you to recall a squad you have never seen, which is not
 * difficulty so much as a different game.
 */
export function pickClub(choices, rnd) {
  const pool = choices.filter(c => c.prom >= 12);
  return pick(rnd, pool.length >= 20 ? pool : choices);
}
