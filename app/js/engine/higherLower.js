// Higher or Lower: compare two players on ONE explicitly scoped metric.
// Validation: never compare unless the gap is decisive. Near-ties are where
// a quiz loses trust, because our source disagrees with official records at
// the margins.
import { pick, sample, weightedSample } from '../rng.js';
import { shortClub } from '../data.js';

const METRICS = [
  { key: 'careerGoals', label: 'career club goals',       scope: 'all clubs, all competitions' },
  { key: 'careerApps',  label: 'career club appearances', scope: 'all clubs, all competitions' },
];
const MIN_GAP_ABS = 25;
const MIN_GAP_REL = 0.18;

export function eligible(db) {
  // statsSuspect players (Wikidata's Pele goal tally counts friendlies) would
  // make an unfair comparison, so they are excluded from this mode only.
  return db.players.filter(p => p.fame >= 50 && p.careerApps > 0 && !p.statsSuspect);
}

export function generate(db, rnd, opts = {}) {
  const pool = opts.pool || eligible(db);
  const m = pick(rnd, METRICS);

  for (let attempt = 0; attempt < 60; attempt++) {
    const [a, b] = weightedSample(rnd, pool, 2);
    if (!a || !b) continue;
    const va = a[m.key], vb = b[m.key];
    if (!va || !vb) continue;

    const gap = Math.abs(va - vb);
    if (gap < MIN_GAP_ABS) continue;                       // too close to trust
    if (gap / Math.max(va, vb) < MIN_GAP_REL) continue;    // proportionally too close
    if (db.tier(a) !== db.tier(b)) continue;               // keep it a fair fight
    if (a.mid != null && b.mid != null && Math.abs(a.mid - b.mid) > 12) continue;

    const winner = va > vb ? a : b;
    return {
      mode: 'higher-lower',
      prompt: `Who has more ${m.label}?`,
      scope: m.scope,
      options: [a, b].map(p => ({
        id: p.id, label: p.name,
        sub: `${p.nationality || ''}${p.position ? ' · ' + p.position : ''}`.trim(),
        value: p[m.key],
        clubs: p.clubs.slice(0, 3).map(c => shortClub(c.club)).join(' · '),
      })),
      answerId: winner.id,
      fact: `${a.name} ${va} — ${b.name} ${vb}`,
    };
  }
  return null;
}
