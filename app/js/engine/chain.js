// The Chain — a team is on the table. Name a player who turned out for it, and
// another team that player played for. That team is now on the table.
//
//   [Everton]  ->  Cahill + Australia
//   [Australia] ->  Riise + Norway
//   [Norway]   ->  Haaland + Man City
//
// A team is a club OR a country, and switching between them is half the game.
// Nothing may be named twice. A turn is 60 seconds; the clock resets on every
// successful link.
import { lookup } from '../names.js';
import { shortClub } from '../data.js';
import { pick } from '../rng.js';

export const LIVES = 3;
export const TURN_SECONDS = 60;

/** Fuzzy lookup over every team you can name: clubs and countries alike. */
export function buildClubIndex(db) {
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\b(f\.?c\.?|a\.?f\.?c\.?|s\.?c\.?|c\.?f\.?|fc|afc)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const byNorm = new Map();
  const add = (label, entry) => {
    const n = norm(label);
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(entry);
  };
  for (const key of db.byClub.keys()) add(shortClub(key), { kind: 'club', key });
  for (const key of db.byNation.keys()) add(key, { kind: 'country', key });
  // two club keys can share a short label (Real Madrid CF and Real Madrid C),
  // and a suggestion list that offers the same words twice looks broken
  const labels = [...new Set([...[...db.byClub.keys()].map(shortClub), ...db.byNation.keys()])];
  return { norm, byNorm, labels };
}

const sizeOf = (db, e) =>
  (e.kind === 'country' ? db.byNation.get(e.key) : db.byClub.get(e.key))?.size || 0;

export function findTeam(idx, db, text, prefer = null) {
  const q = idx.norm(text);
  if (q.length < 3) return null;
  const choose = (list) => {
    if (!list || !list.length) return null;
    // a team the named player actually belongs to wins ties
    if (prefer) { const m = list.filter(e => prefer.has(e.key)); if (m.length) return m[0]; }
    return list.slice().sort((a, b) => sizeOf(db, b) - sizeOf(db, a))[0];
  };
  const exact = choose(idx.byNorm.get(q));
  if (exact) return exact;
  const partial = [];
  for (const [n, entries] of idx.byNorm) if (n.includes(q)) partial.push(...entries);
  return choose(partial);
}

export const membersOf = (db, side) =>
  (side.kind === 'country' ? db.byNation.get(side.key) : db.byClub.get(side.key)) || new Set();

export const sideLabel = (side) => side.kind === 'country' ? side.key : shortClub(side.key);

/** Every team a player belongs to: clubs, and any country he represented. */
export const teamsOf = (p) => {
  const t = new Set(p.allClubs || []);
  for (const c of (p.countries || [])) t.add(c);
  if (p.nationality) t.add(p.nationality);
  return t;
};

/**
 * Open the chain the way a round opens at the table: a famous player and one
 * team he played for. That team is what the first turn has to answer.
 */
export function pickStarter(db, rnd) {
  const named = db.players.filter(p => (p.fame || 0) > 0 && teamsOf(p).size >= 2);
  const pool = named.length ? named.slice().sort((a, b) => (b.fame || 0) - (a.fame || 0)).slice(0, 300) : db.players;
  for (let i = 0; i < 40; i++) {
    const p = pick(rnd, pool);
    const teams = [...teamsOf(p)].map(key =>
      db.byNation.has(key) ? { kind: 'country', key } : db.byClub.has(key) ? { kind: 'club', key } : null
    ).filter(t => t && sizeOf(db, t) >= 40)
      .sort((a, b) => sizeOf(db, b) - sizeOf(db, a)).slice(0, 3);
    if (teams.length) return { player: p, side: pick(rnd, teams) };
  }
  return null;
}

export function createGame({ names, starter }) {
  const { player, side } = starter;
  return {
    players: names.map(n => ({ name: n, lives: LIVES, out: false })),
    turn: 0,
    team: side,                             // the team on the table
    chain: [
      { kind: 'player', id: player.id, name: player.name },
      { kind: 'team', name: sideLabel(side), country: side.kind === 'country' },
    ],
    usedPlayers: new Set([player.id]),
    usedTeams: new Set([side.key]),
    finished: false, winner: null,
  };
}

/**
 * A turn: a player from the team on the table, and another team he played for.
 * Both halves are checked - a link that satisfies only one would send the
 * chain somewhere the player never was, and look valid doing it.
 */
export function submit(db, nameIdx, teamIdx, game, playerText, teamText) {
  const roster = membersOf(db, game.team);
  const p = lookup(nameIdx, playerText, roster);
  if (!p) return { status: 'no-player' };
  if (game.usedPlayers.has(p.id)) return { status: 'player-used', player: p };
  if (!roster.has(p.id)) return { status: 'not-in-team', player: p };

  const theirs = teamsOf(p);
  const side = findTeam(teamIdx, db, teamText, theirs);
  if (!side) return { status: 'no-team', player: p };
  const team = sideLabel(side);
  if (!theirs.has(side.key)) return { status: 'not-their-team', player: p, team };
  if (game.usedTeams.has(side.key)) return { status: 'team-used', player: p, team };
  return { status: 'ok', player: p, side, team };
}

export function apply(game, res) {
  const me = game.players[game.turn];
  if (res.status === 'ok') {
    game.usedPlayers.add(res.player.id);
    game.usedTeams.add(res.side.key);
    game.chain.push({ kind: 'player', id: res.player.id, name: res.player.name, by: me.name });
    game.chain.push({ kind: 'team', name: res.team, country: res.side.kind === 'country', by: me.name });
    game.team = res.side;
  } else {
    me.lives--;
    if (me.lives <= 0) me.out = true;
  }
  const alive = game.players.filter(p => !p.out);
  if (game.players.length > 1 && alive.length <= 1) {
    game.finished = true; game.winner = game.players.indexOf(alive[0]); return game;
  }
  if (game.players.length === 1 && game.players[0].out) { game.finished = true; return game; }
  let n = game.turn;
  do { n = (n + 1) % game.players.length; } while (game.players[n].out);
  game.turn = n;
  return game;
}

/** The clock running out is a failed turn, scored the same as a bad link. */
export const timeout = (game) => apply(game, { status: 'timeout' });

export const explain = (r, team) => ({
  'no-player':      'No player by that name found',
  'player-used':    `${r.player?.name} has already been used`,
  'not-in-team':    `${r.player?.name} never played for ${team}`,
  'no-team':        'No club or country by that name found',
  'not-their-team': `${r.player?.name} never played for ${r.team}`,
  'team-used':      `${r.team} has already been used`,
  timeout:          'Out of time',
  ok:               `${r.player?.name} → ${r.team}`,
}[r.status]);
