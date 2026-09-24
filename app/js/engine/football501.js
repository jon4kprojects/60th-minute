// Football 501 — darts scoring with footballers.
//
// Each player starts on 501, a club is chosen, and you take turns naming
// players who turned out for them. Their appearances (or goals) for that club
// come off your total. Anything over 180 scores nothing, mirroring the maximum
// visit in darts, so the skill is finding players with a usable number rather
// than simply the most famous name.
import { lookup } from '../names.js';

export const MAX_VISIT = 180;
// Labelled "appearances", not "league appearances": Wikidata mixes the two
// conventions (Giggs is recorded at 672 for Man Utd, which is all competitions;
// Gerrard at 504 for Liverpool, which is league only). Claiming league-only
// precision we do not have would be the fastest way to lose players' trust.
export const METRICS = {
  apps:  { label: 'appearances', short: 'apps' },
  goals: { label: 'goals',       short: 'goals' },
};

export function clubsWithDepth(db, min = 15) {
  const c = new Map();
  for (const p of db.players)
    for (const s of p.clubs) {
      if (!c.has(s.club)) c.set(s.club, { name: s.club, country: s.country, n: 0 });
      c.get(s.club).n++;
    }
  return [...c.values()].filter(x => x.n >= min).sort((a, b) => b.n - a.n);
}

export const rosterOf = (db, clubName) =>
  new Set(db.players.filter(p => p.clubs.some(c => c.club === clubName)).map(p => p.id));

export function createGame({ club, metric, names, checkoutLow = -10 }) {
  return {
    club, metric, checkoutLow,
    players: names.map(n => ({ name: n, score: 501, history: [] })),
    turn: 0, used: new Set(), finished: false, winner: null,
  };
}

// Total for the club across every spell there (Henry had two Arsenal spells).
export const valueFor = (player, clubName, metric) =>
  player.clubs.filter(c => c.club === clubName)
              .reduce((a, c) => a + (c[metric] || 0), 0);

/**
 * Resolve a typed name into a scored turn. Returns a result describing what
 * happened; it never mutates. `applyTurn` commits it.
 */
export function scoreEntry(db, idx, game, rawName) {
  const roster = rosterOf(db, game.club);
  const p = lookup(idx, rawName, roster);
  if (!p) return { status: 'unknown', score: 0 };
  if (game.used.has(p.id)) return { status: 'duplicate', player: p, score: 0 };
  if (!roster.has(p.id)) return { status: 'ineligible', player: p, score: 0 };

  const raw = valueFor(p, game.club, game.metric);
  if (!raw) return { status: 'no-data', player: p, score: 0, raw: 0 };

  const over = raw > MAX_VISIT;
  const score = over ? 0 : raw;
  const cur = game.players[game.turn].score;
  const rem = cur - score;

  if (rem < game.checkoutLow) return { status: 'bust', player: p, raw, score: 0 };
  if (rem <= 0)               return { status: 'win',  player: p, raw, score, remaining: rem };
  return { status: over ? 'over-max' : 'ok', player: p, raw, score, remaining: rem };
}

export function applyTurn(game, result) {
  const me = game.players[game.turn];
  if (result.player) game.used.add(result.player.id);
  me.history.push({
    name: result.player ? result.player.name : null,
    raw: result.raw ?? 0, score: result.score, status: result.status,
  });
  if (result.status === 'win') {
    me.score = result.remaining;
    game.finished = true; game.winner = game.turn;
  } else {
    me.score -= result.score;
    game.turn = (game.turn + 1) % game.players.length;
  }
  return game;
}

export const explain = (r, metricLabel) => ({
  unknown:    'No player by that name found',
  duplicate:  `${r.player?.name} has already been named this round`,
  ineligible: `${r.player?.name} never played for this club`,
  'no-data':  `No ${metricLabel} recorded for ${r.player?.name} here`,
  'over-max': `${r.player?.name} — ${r.raw} ${metricLabel}. Over 180, scores nothing`,
  bust:       `${r.player?.name} — ${r.raw}. Too many, you bust`,
  ok:         `${r.player?.name} — ${r.raw} ${metricLabel}`,
  win:        `${r.player?.name} — ${r.raw}. Checked out!`,
}[r.status]);
