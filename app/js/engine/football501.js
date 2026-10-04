// Football 501 — darts scoring with footballers.
//
// Each player starts on 501, a club is chosen, and you take turns naming
// players who turned out for them. Their appearances (or goals) for that club
// come off your total. Anything over 180 scores nothing, mirroring the maximum
// visit in darts, so the skill is finding players with a usable number rather
// than simply the most famous name.
import { lookup } from '../names.js';
import { shortClub } from '../data.js';

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
/** Throws this player has left under a limit, or null when there is none. */
export const throwsLeft = (game, i = game.turn) =>
  game.limit ? Math.max(0, game.limit - game.players[i].history.length) : null;

export const statKey = (metric, scope) =>
  scope === 'league' ? 'lg' + metric[0].toUpperCase() + metric.slice(1) : metric;

/**
 * National sides playable here, and how deep each is.
 *
 * The international game scores caps and international goals, which Wikidata
 * records per national team rather than per career - Cahill's Australia figures
 * are separate from his two Samoa caps, and a Germany leg should not be scored
 * on either. A side needs enough players carrying figures to be worth a leg.
 */
export function teamsWithDepth(db, min = 25) {
  const out = [];
  for (const [team, ids] of db.byNation) {
    let n = 0;
    for (const id of ids) {
      const t = db.byId.get(id);
      const nt = t && t.nationalTotals && t.nationalTotals[team];
      if (nt && (nt.caps || nt.goals)) n++;
    }
    if (n >= min) out.push({ name: team, country: team, n, kind: 'country' });
  }
  return out.sort((a, b) => b.n - a.n);
}

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
// Reserve and academy sides survive as clubs in their own right because people
// genuinely played for them, but a leg of Real Madrid C is not a leg of Real
// Madrid, and offering both in one list invites the wrong pick.
const RESERVE = /\b(?:B|C|II|III|U-?\d\d|Juvenil|Castilla|Atl[eè]tic|Reserves?|Academy|Youth|Amateure?)$|\bB team\b|\bII\b|^Jong\s/i;

export function clubsWithDepth(db, min = 15) {
  const pool = db.playableClubs && db.playableClubs.size ? db.playableClubs : db.verifiedClubs;
  const c = new Map();
  for (const p of db.players)
    for (const s of p.clubs) {
      if (pool.size && !pool.has(s.club)) continue;
      if (RESERVE.test(s.club)) continue;
      if (!c.has(s.club)) c.set(s.club, { name: s.club, country: s.country, n: 0 });
      c.get(s.club).n++;
    }
  return [...c.values()].filter(x => x.n >= min).sort((a, b) => b.n - a.n);
}

// Eligibility is "did he ever turn out for them", so it reads allClubs - a
// 12-game spell still counts.
export const rosterOf = (db, name, kind = 'club') => {
  if (kind === 'country') return db.byNation.get(name) || new Set();
  return new Set(db.players.filter(p =>
    (p.allClubs || p.clubs.map(c => c.club)).includes(name)).map(p => p.id));
};

export const STARTS = [301, 401, 501];
export const HINT_ALLOWANCES = [0, 3, 5];
export const TURN_TIMES = [0, 30, 60];
export const THROW_LIMITS = [0, 10];

export function createGame({ club, kind = 'club', metric, scope = 'all', names,
                             start = 501, hints = 3, turnSeconds = 0, limit = 0 }) {
  return {
    club, kind, metric, scope, start, turnSeconds, limit,
    players: names.map(n => ({ name: n, score: start, history: [], hints })),
    turn: 0, used: new Set(), finished: false, winner: null,
  };
}

/**
 * Abandon the round. There is nothing hidden in 501 to reveal, so giving up
 * ends it on a count-back: lowest score wins, the way an abandoned leg would be
 * judged. Calling it a win would be a lie, so the result says it was given up.
 */
export function giveUp(game) {
  let best = 0;
  game.players.forEach((p, i) => { if (p.score < game.players[best].score) best = i; });
  game.finished = true;
  game.abandoned = true;
  game.winner = best;
  return game;
}

/**
 * Every eligible player still unthrown whose figure would not bust you, with
 * the name taken out: what he scored, where he played and in what order, when
 * he started and stopped, his country and his position.
 *
 * Highest first, so the top row is the checkout if one exists. Everything shown
 * is what the mode already deals in - goals for a goals leg, caps for a country
 * - and the club list is the giveaway, which is the point: it costs a hint.
 */
export function redactedList(db, game, max = 40) {
  const me = game.players[game.turn];
  const rows = [];
  for (const id of rosterOf(db, game.club, game.kind)) {
    if (game.used.has(id)) continue;
    const p = db.byId.get(id);
    if (!p) continue;
    const v = valueFor(p, game.club, game.metric, game.scope, game.kind);
    if (v > me.score) continue;
    const years = p.clubs.map(c => c.from).filter(Boolean);
    const open = p.clubs.some(c => c.from && c.from === Math.max(...years) && !c.to);
    const ends = p.clubs.map(c => c.to).filter(Boolean);
    rows.push({
      value: v,
      nationality: p.nationality || null,
      position: p.position || null,
      from: years.length ? Math.min(...years) : null,
      to: open ? null : (ends.length ? Math.max(...ends) : null),
      ongoing: open,
      // Dated spells in order, then any club we know he played for but hold no
      // dates for. Without the second half the club being played could be
      // missing from the very career it belongs to: a short Real Madrid spell
      // lives in the membership layer while the ordered path only carries
      // spells with figures, and a list that omits Real Madrid is no clue at all.
      clubs: (() => {
        const dated = p.clubs.slice().sort((a, b) => (a.from || 0) - (b.from || 0))
                              .map(c => shortClub(c.club));
        const seen = new Set(dated);
        const rest = [...new Set((p.allClubs || []).map(shortClub))].filter(c => !seen.has(c));
        return [...dated, ...rest];
      })(),
    });
  }
  rows.sort((a, b) => b.value - a.value);
  return { rows: rows.slice(0, max), total: rows.length };
}

/**
 * Everyone has had their throws and nobody has checked out, so the lowest score
 * takes it. A leg that runs until somebody lands exactly can go on a long time
 * once the obvious names are spent; this ends it on a count-back instead.
 */
function limitReached(game) {
  return game.limit > 0 && game.players.every(p => p.history.length >= game.limit);
}

function settle(game) {
  let best = 0;
  game.players.forEach((p, i) => { if (p.score < game.players[best].score) best = i; });
  game.finished = true;
  game.winner = best;
  game.onLimit = true;
  // a tie on the count-back is a tie, and saying otherwise would be a fiction
  game.drawn = game.players.filter(p => p.score === game.players[best].score).length > 1;
  return game;
}

/**
 * What each player needed, and who would have done it.
 *
 * The checkout is the whole tension of a leg, and on 17 left you want to know
 * afterwards that Bergkamp was sitting there on 17 all along. Only players
 * nobody has used are listed, since a used name could not have been thrown.
 */
export function checkouts(db, game, limit = 8) {
  const roster = [...rosterOf(db, game.club, game.kind)]
    .filter(id => !game.used.has(id))
    .map(id => db.byId.get(id))
    .filter(Boolean);
  return game.players.map((p) => ({
    name: p.name,
    score: p.score,
    names: roster
      .filter(x => valueFor(x, game.club, game.metric, game.scope, game.kind) === p.score)
      .sort((a, b) => (b.fame || 0) - (a.fame || 0))
      .slice(0, limit)
      .map(x => x.name),
  }));
}

/** Pass, or run out of time: the turn moves on and the score stays put. */
export function passTurn(game, reason = 'pass') {
  const me = game.players[game.turn];
  me.history.push({ name: null, raw: 0, score: 0, status: reason });
  game.turn = (game.turn + 1) % game.players.length;
  if (limitReached(game)) settle(game);
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
  const roster = [...rosterOf(db, game.club, game.kind)]
    .filter(id => !game.used.has(id))
    .map(id => db.byId.get(id))
    .filter(p => p && valueFor(p, game.club, game.metric, game.scope, game.kind) > 0);
  if (roster.length < n) return null;
  const safe = roster.filter(p =>
    valueFor(p, game.club, game.metric, game.scope, game.kind) <= me.score);
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
export const valueFor = (player, clubName, metric, scope = 'all', kind = 'club') => {
  // A national side keeps its own figures. There is no league/cup split to an
  // international career, so scope does not apply.
  if (kind === 'country') {
    const n = player.nationalTotals && player.nationalTotals[clubName];
    if (!n) return 0;
    return (metric === 'goals' ? n.goals : n.caps) || 0;
  }
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
  const roster = rosterOf(db, game.club, game.kind);
  const p = lookup(idx, rawName, roster);
  if (!p) return { status: 'unknown', score: 0 };
  if (game.used.has(p.id)) return { status: 'duplicate', player: p, score: 0 };
  if (!roster.has(p.id)) return { status: 'ineligible', player: p, score: 0 };

  const raw = valueFor(p, game.club, game.metric, game.scope, game.kind);
  // A genuine zero is a legitimate turn, not missing data: Mascherano really
  // did score none for West Ham. Only treat it as missing if we hold nothing
  // for that club at all.
  const held = game.kind === 'country'
    ? (p.nationalTotals && p.nationalTotals[game.club])
    : (p.clubTotals && p.clubTotals[game.club]);
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
    if (limitReached(game)) settle(game);
  }
  return game;
}

export const explain = (r, metricLabel) => ({
  unknown:    'No player by that name found',
  duplicate:  `${r.player?.name} has already been named this round`,
  ineligible: `${r.player?.name} never played for them`,
  'no-data':  `No ${metricLabel} recorded for ${r.player?.name} here`,
  bust:       `${r.player?.name} \u2014 ${r.raw}. Too many: bust, back to ${r.back}`,
  pass:       'Passed',
  timeout:    'Out of time',
  ok:         r.raw === 0 ? `${r.player?.name} — none. Nothing off`
                          : `${r.player?.name} — ${r.raw} ${metricLabel}`,
  win:        `${r.player?.name} — ${r.raw}. Checked out!`,
}[r.status]);
