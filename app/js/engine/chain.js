// The Chain — a player, then a club they played for, then someone else from
// that club, and on it goes. Nothing may be named twice.
//
//   Henry  ->  Arsenal + Bergkamp  ->  Ajax + Kluivert  ->  Barcelona + ...
//
// Validation is deliberately strict in both directions: the club must be one
// the player on the table actually turned out for, AND the new player must
// have turned out for that same club. Checking only one half would let the
// chain drift somewhere neither of them ever played.
import { lookup } from '../names.js';
import { shortClub } from '../data.js';
import { weightedPick, FAME_W } from '../rng.js';

export const LIVES = 3;

/** Fuzzy club lookup over the clubs we actually hold. */
export function buildClubIndex(db) {
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\b(f\.?c\.?|a\.?f\.?c\.?|s\.?c\.?|c\.?f\.?|fc|afc)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const byNorm = new Map();
  for (const key of db.byClub.keys()) {
    const n = norm(shortClub(key));
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(key);
  }
  return { norm, byNorm, keys: [...db.byClub.keys()] };
}

export function findClub(idx, db, text, prefer = null) {
  const q = idx.norm(text);
  if (q.length < 3) return null;
  const pick = (list) => {
    if (!list || !list.length) return null;
    if (prefer) { const m = list.filter(k => prefer.has(k)); if (m.length) return m[0]; }
    // otherwise the club we hold most players for, which is the best-known one
    return list.slice().sort((a, b) => (db.byClub.get(b)?.size || 0) - (db.byClub.get(a)?.size || 0))[0];
  };
  const exact = pick(idx.byNorm.get(q));
  if (exact) return exact;
  const partial = idx.keys.filter(k => idx.norm(shortClub(k)).includes(q));
  return pick(partial);
}

export function pickStarter(db, rnd) {
  const pool = db.players.filter(p => p.fame >= 70 && (p.allClubs || []).length >= 3);
  return pool.length ? weightedPick(rnd, pool, FAME_W) : null;
}

export function createGame({ names, starter }) {
  return {
    players: names.map(n => ({ name: n, lives: LIVES, out: false })),
    turn: 0,
    current: starter,                       // the player on the table
    chain: [{ kind: 'player', id: starter.id, name: starter.name }],
    usedPlayers: new Set([starter.id]),
    usedClubs: new Set(),
    finished: false, winner: null,
  };
}

export function submit(db, nameIdx, clubIdx, game, clubText, playerText) {
  const theirs = new Set(game.current.allClubs || []);
  const club = findClub(clubIdx, db, clubText, theirs);
  if (!club) return { status: 'no-club' };
  if (!theirs.has(club)) return { status: 'not-their-club', club };
  if (game.usedClubs.has(club)) return { status: 'club-used', club };

  const roster = db.byClub.get(club) || new Set();
  const p = lookup(nameIdx, playerText, roster);
  if (!p) return { status: 'no-player', club };
  if (p.id === game.current.id) return { status: 'same-player', club, player: p };
  if (game.usedPlayers.has(p.id)) return { status: 'player-used', club, player: p };
  if (!roster.has(p.id)) return { status: 'not-at-club', club, player: p };
  return { status: 'ok', club, player: p };
}

export function apply(game, res) {
  const me = game.players[game.turn];
  if (res.status === 'ok') {
    game.usedClubs.add(res.club);
    game.usedPlayers.add(res.player.id);
    game.chain.push({ kind: 'club', name: res.club, by: me.name });
    game.chain.push({ kind: 'player', id: res.player.id, name: res.player.name, by: me.name });
    game.current = res.player;
  } else {
    me.lives--;
    if (me.lives <= 0) me.out = true;
  }
  // next player still in it
  const alive = game.players.filter(p => !p.out);
  if (alive.length <= 1 && game.players.length > 1) {
    game.finished = true;
    game.winner = game.players.indexOf(alive[0]);
    return game;
  }
  if (game.players.length === 1 && game.players[0].out) { game.finished = true; return game; }
  let n = game.turn;
  do { n = (n + 1) % game.players.length; } while (game.players[n].out);
  game.turn = n;
  return game;
}

export const explain = (r, current) => ({
  'no-club':        'No club by that name found',
  'not-their-club': `${current.name} never played for ${shortClub(r.club || '')}`,
  'club-used':      `${shortClub(r.club || '')} has already been used`,
  'no-player':      'No player by that name found',
  'same-player':    `That is ${current.name} again`,
  'player-used':    `${r.player?.name} has already been used`,
  'not-at-club':    `${r.player?.name} never played for ${shortClub(r.club || '')}`,
  ok:               `${shortClub(r.club || '')} → ${r.player?.name}`,
}[r.status]);
