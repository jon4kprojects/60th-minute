import * as careerPath from './careerPath.js';
import * as higherLower from './higherLower.js';
import * as whoAmI from './whoAmI.js';

// Adding a mode means adding a file and one line here. Nothing else changes.
export const MODES = {
  'career-path':  { title: 'Career Path',     blurb: 'Name the player from his clubs', gen: careerPath },
  'higher-lower': { title: 'Higher or Lower', blurb: 'Pick the bigger number',         gen: higherLower },
  'who-am-i':     { title: 'Who Am I?',       blurb: 'Fewer clues, more points',       gen: whoAmI },
};

export function buildRound(db, rnd, modeKeys, n = 10) {
  const out = [], pools = {};
  for (const k of modeKeys) pools[k] = MODES[k].gen.eligible(db);
  let guard = 0;
  while (out.length < n && guard++ < n * 25) {
    const k = modeKeys[out.length % modeKeys.length];
    const q = MODES[k].gen.generate(db, rnd, { pool: pools[k] });
    if (!q) continue;
    if (out.some(o => o.answerId === q.answerId && o.mode === q.mode)) continue;
    out.push(q);
  }
  return out;
}
