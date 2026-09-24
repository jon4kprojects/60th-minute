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
  goals: { label: 'goals',       short: 'goals' },
  apps:  { label: 'appearances', short: 'apps' },
};

// Competition scope is a separate axis from the statistic, and both sides are
// sourced. All-competition totals come from club player lists; league-only
// figures come from each player's own infobox, where the club rows are league
// appearances by convention (Wikipedia annotates it as such). Club lists alone
// could not back this - none of them break league out.
export const SCOPES = {
  all:    { label: 'all competitions', suffix: '' },
  league: { label: 'league only',      suffix: 'lg' },
};
export const statKey = (metric, scope) =>
  scope === 'league' ? 'lg' + metric[0].toUpperCase() + metric.slice(1) : metric;

/** Does this club have enough league-only coverage to offer the choice? */
export const hasLeagueSplit = (db, clubName) =>
  db.leagueScopeClubs ? db.leagueScopeClubs.has(clubName) : false;

/**
 * Only clubs with verified figures are playable here.
 *
 * Our unverified numbers are inconsistently scoped - mostly league appearances,
 * some all-competitions, and a few simply wrong (Drogba read 28 for Chelsea
 * against a real 381). A quiz cannot defend that, so an unverified club is not
 * offered at all. A short club list beats one wrong answer.
 */
export function clubsWithDepth(db, min = 15) {
  const c = new Map();
  for (const p of db.players)
    for (const s of p.clubs) {
      if (db.verifiedClubs.size && !db.verifiedClubs.has(s.club)) continue;
      if (!c.has(s.club)) c.set(s.club, { name: s.club, country: s.country, n: 0 });
      c.get(s.club).n++;
    }
  return [...c.values()].filter(x => x.n >= min).sort((a, b) => b.n - a.n);
}

// Eligibility is "did he ever turn out for them", so it reads allClubs - a
// 12-game spell still counts.
export const rosterOf = (db, clubName) =>
  new Set(db.players.filter(p =>
    (p.allClubs || p.clubs.map(c => c.club)).includes(clubName)).map(p => p.id));

export function createGame({ club, metric, scope = 'all', names, checkoutLow = -10 }) {
  return {
    club, metric, scope, checkoutLow,
    players: names.map(n => ({ name: n, score: 501, history: [] })),
    turn: 0, used: new Set(), finished: false, winner: null,
  };
}

/**
 * The player's figure for this club.
 *
 * Prefers the verified club total, which is already a whole-career figure for
 * that club. Falling back to summing spells is only for unverified clubs -
 * summing a verified total across two spells made Drogba read 328 Chelsea
 * goals instead of 164.
 */
export const valueFor = (player, clubName, metric, scope = 'all') => {
  const t = player.clubTotals && player.clubTotals[clubName];
  if (t) {
    const k = statKey(metric, scope);
    if (t[k] != null) return t[k];
    return t[metric] || 0;                       // fall back to all-competitions
  }
  return player.clubs.filter(c => c.club === clubName)
                     .reduce((a, c) => a + (c[metric] || 0), 0);
};

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

  const raw = valueFor(p, game.club, game.metric, game.scope);
  // A genuine zero is a legitimate turn, not missing data: Mascherano really
  // did score none for West Ham. Only treat it as missing if we hold nothing
  // for that club at all.
  const held = p.clubTotals && p.clubTotals[game.club];
  if (raw === 0 && !held) return { status: 'no-data', player: p, score: 0, raw: 0 };

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
  ok:         r.raw === 0 ? `${r.player?.name} — none. Nothing off`
                          : `${r.player?.name} — ${r.raw} ${metricLabel}`,
  win:        `${r.player?.name} — ${r.raw}. Checked out!`,
}[r.status]);
