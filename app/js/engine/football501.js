// Football 501 — darts scoring with footballers.
//
// Each player starts on 501, a club is chosen, and you take turns naming
// players who turned out for them. Their appearances (or goals) for that club
// come off your total. Anything over 180 scores nothing, mirroring the maximum
// visit in darts, so the skill is finding players with a usable number rather
// than simply the most famous name.
import { lookup } from '../names.js';

// Labelled "appearances", not "league appearances": Wikidata mixes the two
// conventions (Giggs is recorded at 672 for Man Utd, which is all competitions;
// Gerrard at 504 for Liverpool, which is league only). Claiming league-only
// precision we do not have would be the fastest way to lose players' trust.
// `label` is for controls and headings; `inline` is for mid-sentence use
// ("185 goals" must not read "185 Goals").
export const METRICS = {
  goals: { label: 'Goals',       inline: 'goals',       short: 'goals' },
  apps:  { label: 'Appearances', inline: 'appearances', short: 'apps' },
};

// Competition scope is a separate axis from the statistic, and both sides are
// sourced. All-competition totals come from club player lists; league-only
// figures come from each player's own infobox, where the club rows are league
// appearances by convention (Wikipedia annotates it as such). Club lists alone
// could not back this - none of them break league out.
export const SCOPES = {
  all:    { label: 'All competitions', inline: 'all competitions', suffix: '' },
  league: { label: 'League only',      inline: 'league only',      suffix: 'lg' },
};
export const statKey = (metric, scope) =>
  scope === 'league' ? 'lg' + metric[0].toUpperCase() + metric.slice(1) : metric;

/** Does this club have league figures? */
export const hasLeagueSplit = (db, clubName) =>
  db.leagueScopeClubs ? db.leagueScopeClubs.has(clubName) : false;

/** Does this club have cross-checked all-competition figures? */
export const hasAllComps = (db, clubName) =>
  db.verifiedClubs ? db.verifiedClubs.has(clubName) : false;

/**
 * Clubs playable here, on figures we can defend.
 *
 * Two tiers. A verified club has all-competition totals cross-checked against
 * its record holder, plus league figures - both scopes. Everything else is
 * playable on league figures from player infoboxes, which are a single
 * consistent convention. Raw Wikidata figures are still never used: they mix
 * scopes and are sometimes simply wrong (Drogba read 28 for Chelsea, not 381).
 */
export function clubsWithDepth(db, min = 15) {
  const pool = db.playableClubs && db.playableClubs.size ? db.playableClubs : db.verifiedClubs;
  const c = new Map();
  for (const p of db.players)
    for (const s of p.clubs) {
      if (pool.size && !pool.has(s.club)) continue;
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

export const STARTS = [301, 401, 501];
export const HINT_ALLOWANCES = [0, 3, 5];
export const TURN_TIMES = [0, 30, 60];

export function createGame({ club, metric, scope = 'all', names,
                             start = 501, hints = 3, turnSeconds = 0 }) {
  return {
    club, metric, scope, start, turnSeconds,
    players: names.map(n => ({ name: n, score: start, history: [], hints })),
    turn: 0, used: new Set(), finished: false, winner: null,
  };
}

/** Pass, or run out of time: the turn moves on and the score stays put. */
export function passTurn(game, reason = 'pass') {
  const me = game.players[game.turn];
  me.history.push({ name: null, raw: 0, score: 0, status: reason });
  game.turn = (game.turn + 1) % game.players.length;
  return game;
}

/**
 * Four eligible players to choose between, spent from a player's allowance.
 *
 * At least one is guaranteed not to bust you where such a player exists, so a
 * hint is worth spending. Without that it could deal four names that all
 * overshoot, which is not help, it is a worse version of guessing.
 */
export function hintOptions(db, game, rnd, n = 4) {
  const me = game.players[game.turn];
  const roster = [...rosterOf(db, game.club)]
    .filter(id => !game.used.has(id))
    .map(id => db.byId.get(id))
    .filter(p => p && valueFor(p, game.club, game.metric, game.scope) > 0);
  if (roster.length < n) return null;
  const safe = roster.filter(p => valueFor(p, game.club, game.metric, game.scope) <= me.score);
  const pick = [];
  if (safe.length) pick.push(safe[Math.floor(rnd() * safe.length)]);
  const rest = roster.filter(p => !pick.includes(p));
  while (pick.length < n && rest.length) {
    pick.push(...rest.splice(Math.floor(rnd() * rest.length), 1));
  }
  for (let i = pick.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pick[i], pick[j]] = [pick[j], pick[i]];
  }
  return pick.map(p => ({ id: p.id, name: p.name }));
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

  const score = raw;
  const cur = game.players[game.turn].score;
  const rem = cur - score;

  // Darts rules: you finish on nothing exactly, and overshooting scores you
  // nothing at all. The slack that used to allow finishing anywhere down to
  // -10 made a checkout a formality - there was almost always somebody who
  // would do. Every low figure from 1 to 20 has players at a club of any size,
  // so an exact finish is reachable, and a bust now costs the turn.
  if (rem < 0)  return { status: 'bust', player: p, raw, score: 0, back: cur };
  if (rem === 0) return { status: 'win',  player: p, raw, score, remaining: 0 };
  return { status: 'ok', player: p, raw, score, remaining: rem };
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
  bust:       `${r.player?.name} \u2014 ${r.raw}. Too many: bust, back to ${r.back}`,
  pass:       'Passed',
  timeout:    'Out of time',
  ok:         r.raw === 0 ? `${r.player?.name} — none. Nothing off`
                          : `${r.player?.name} — ${r.raw} ${metricLabel}`,
  win:        `${r.player?.name} — ${r.raw}. Checked out!`,
}[r.status]);
