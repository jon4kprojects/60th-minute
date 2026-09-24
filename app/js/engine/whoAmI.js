// Who Am I?: reveal structured clues one at a time. Fewer clues = more points.
// Every clue is read from a field. Nothing is composed or inferred, so a clue
// can never assert something the data does not actually say.
import { pick, sample, shuffle, weightedPick, FAME_W } from '../rng.js';
import { shortClub } from '../data.js';

export function eligible(db) {
  return db.players.filter(p => p.fame >= 55 && p.clubs.length >= 2 && p.nationality);
}

const era = (p) => {
  const y = p.clubs.map(c => c.from).filter(Boolean);
  if (!y.length) return null;
  const a = Math.min(...y), b = Math.max(...p.clubs.map(c => c.to || c.from).filter(Boolean), a);
  return `Played between ${a} and ${b}`;
};

export function generate(db, rnd, opts = {}) {
  const pool = opts.pool || eligible(db);
  for (let attempt = 0; attempt < 40; attempt++) {
    const p = weightedPick(rnd, pool, FAME_W);
    const clues = [];
    if (p.nationality) clues.push(`Nationality: ${p.nationality}`);
    if (p.position)    clues.push(`Position: ${p.position}`);
    const e = era(p); if (e) clues.push(e);
    if (p.careerApps)  clues.push(`Around ${Math.round(p.careerApps / 50) * 50} career club appearances`);
    // clubs revealed last, least famous first, so the giveaway comes latest
    const clubs = p.clubs.slice().sort((x, y) => (x.apps || 0) - (y.apps || 0));
    for (const c of clubs.slice(0, 3)) clues.push(`Played for ${shortClub(c.club)}`);
    if (p.careerGoals) clues.push(`Scored roughly ${Math.round(p.careerGoals / 25) * 25} career club goals`);
    if (clues.length < 4) continue;

    const dec = db.players.filter(d => d.id !== p.id && db.tier(d) === db.tier(p) &&
      d.mid != null && p.mid != null && Math.abs(d.mid - p.mid) <= 7);
    if (dec.length < 3) continue;

    return {
      mode: 'who-am-i',
      prompt: 'Who am I?',
      clues,
      options: shuffle(rnd, [p, ...sample(rnd, dec, 3)]).map(o => ({ id: o.id, label: o.name })),
      answerId: p.id,
      fact: `${p.name} — ${p.clubs.map(c => shortClub(c.club)).join(' → ')}`,
    };
  }
  return null;
}
