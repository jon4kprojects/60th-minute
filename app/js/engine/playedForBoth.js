// Played for Both — two clubs are shown with a count, and you name everyone
// who turned out for each of them.
//
// The count is OUR count, from this dataset, not football's. That is the one
// thing that could lose trust here, so a guess we cannot place is answered
// honestly ("played for Arsenal, not Chelsea" / "not in our database") rather
// than flatly marked wrong, and only genuine misses cost a life.
import { pick, shuffle } from '../rng.js';
import { lookup } from '../names.js';
import { shortClub } from '../data.js';

const MIN_ON_BOARD = 5, MAX_ON_BOARD = 15;
const CLUB_PROM = 8, NAT_PROM = 10;
export const LIVES = 3;

const inter = (a, b) => { const o = new Set(); for (const x of a) if (b.has(x)) o.add(x); return o; };

export function boards(db) {
  return [...db.clubProm].filter(([, n]) => n >= CLUB_PROM).map(([c]) => c);
}

export function generate(db, rnd, opts = {}) {
  const clubs = opts.clubs || boards(db);
  const nats = [...db.natProm].filter(([, n]) => n >= NAT_PROM).map(([c]) => c);
  if (clubs.length < 2) return null;

  for (let attempt = 0; attempt < 40; attempt++) {
    const countryMode = nats.length && rnd() < 0.3;
    const a = pick(rnd, clubs);
    const setA = db.byClub.get(a);
    const others = countryMode
      ? nats.map(n => ({ key: n, label: n, set: db.byNation.get(n), kind: 'country' }))
      : clubs.filter(c => c !== a).map(c => ({ key: c, label: shortClub(c), set: db.byClub.get(c), kind: 'club' }));

    const fits = others
      .map(o => ({ ...o, shared: inter(setA, o.set) }))
      .filter(o => o.shared.size >= MIN_ON_BOARD && o.shared.size <= MAX_ON_BOARD);
    if (!fits.length) continue;

    const b = pick(rnd, fits);
    const answers = [...b.shared].sort((x, y) => db.byId.get(y).fame - db.byId.get(x).fame);
    return {
      mode: 'played-for-both',
      left: { key: a, label: shortClub(a), kind: 'club' },
      right: { key: b.key, label: b.label, kind: b.kind },
      answerIds: answers,
      count: answers.length,
    };
  }
  return null;
}

export function createGame(board) {
  return { board, found: new Set(), lives: LIVES, wrong: [], finished: false, gaveUp: false };
}

const onSide = (db, p, side) =>
  side.kind === 'country' ? p.nationality === side.key : p.clubs.some(c => c.club === side.key);

export function guess(db, idx, game, raw) {
  const b = game.board;
  const p = lookup(idx, raw, new Set(b.answerIds));
  if (!p) return { status: 'unknown' };
  if (game.found.has(p.id)) return { status: 'already', player: p };
  if (b.answerIds.includes(p.id)) return { status: 'hit', player: p };
  const l = onSide(db, p, b.left), r = onSide(db, p, b.right);
  if (l || r) return { status: 'one-side', player: p, side: l ? b.left : b.right, missing: l ? b.right : b.left };
  return { status: 'neither', player: p };
}

export function apply(game, res) {
  if (res.status === 'hit') {
    game.found.add(res.player.id);
    if (game.found.size === game.board.count) game.finished = true;
  } else if (res.status === 'one-side' || res.status === 'neither') {
    // A name we simply do not hold is a gap in our data, not a bad guess,
    // so 'unknown' never costs a life.
    game.lives--;
    game.wrong.push(res.player.name);
    if (game.lives <= 0) game.finished = true;
  }
  return game;
}

export const explain = (r, board) => ({
  unknown:    'No player by that name found',
  already:    `${r.player?.name} is already on the board`,
  hit:        `${r.player?.name} ✓`,
  'one-side': `${r.player?.name} played for ${r.side?.label}, but not ${r.missing?.label}`,
  neither:    `${r.player?.name} played for neither`,
}[r.status]);
