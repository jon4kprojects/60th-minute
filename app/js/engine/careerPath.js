// Career Path: show a club sequence, identify the player.
// Validation: the displayed sequence must identify exactly ONE player in the
// dataset, otherwise the question has more than one defensible answer.
import { pick, sample, shuffle, weightedPick, FAME_W } from '../rng.js';
import { shortClub } from '../data.js';

const MIN_CLUBS = 3;

export function eligible(db) {
  return db.players.filter(p => p.clubs.length >= MIN_CLUBS && p.fame >= 45);
}

const key = (p) => p.clubs.map(c => c.club).join('>');

export function generate(db, rnd, opts = {}) {
  const pool = opts.pool || eligible(db);
  if (pool.length < 4) return null;

  // sequences shared by more than one player are ambiguous and get rejected
  const seen = new Map();
  for (const p of db.players) {
    const k = key(p);
    seen.set(k, (seen.get(k) || 0) + 1);
  }

  for (let attempt = 0; attempt < 40; attempt++) {
    const answer = weightedPick(rnd, pool, FAME_W);
    if (seen.get(key(answer)) !== 1) continue;

    // decoys matched on era and fame tier so the question tests football
    // knowledge rather than "which of these four names do I recognise"
    const dec = db.players.filter(p =>
      p.id !== answer.id &&
      db.tier(p) === db.tier(answer) &&
      p.clubs.length >= MIN_CLUBS &&
      p.mid != null && answer.mid != null && Math.abs(p.mid - answer.mid) <= 7);
    if (dec.length < 3) continue;

    const options = shuffle(rnd, [answer, ...sample(rnd, dec, 3)]);
    return {
      mode: 'career-path',
      prompt: 'Which player had this career?',
      clubs: answer.clubs.map(c => ({ name: shortClub(c.club), from: c.from, to: c.to })),
      options: options.map(o => ({ id: o.id, label: o.name })),
      answerId: answer.id,
      fact: `${answer.name} — ${answer.nationality || 'unknown'}${answer.position ? ', ' + answer.position : ''}`,
    };
  }
  return null;
}
