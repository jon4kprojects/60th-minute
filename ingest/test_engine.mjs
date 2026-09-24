// Smoke test: generate questions and assert they are well-formed and answerable.
import { readFileSync } from 'fs';
import { mulberry32 } from '../app/js/rng.js';
import { MODES, buildRound } from '../app/js/engine/index.js';

globalThis.fetch = async () => ({ ok: true, json: async () =>
  JSON.parse(readFileSync('app/data/dataset.json', 'utf8')) });
const { loadData } = await import('../app/js/data.js');
const db = await loadData();
console.log(`dataset: ${db.players.length} players\n`);

let fails = 0;
for (const [key, m] of Object.entries(MODES)) {
  const rnd = mulberry32(42);
  let made = 0, bad = 0;
  const seenAnswers = new Set();
  for (let i = 0; i < 300; i++) {
    const q = m.gen.generate(db, rnd);
    if (!q) continue;
    made++;
    seenAnswers.add(q.answerId);
    const ids = q.options.map(o => o.id);
    if (!ids.includes(q.answerId)) { bad++; continue; }              // answer must be offered
    if (new Set(ids).size !== ids.length) { bad++; continue; }       // no duplicate options
    if (q.options.length < 2) { bad++; continue; }
    if (q.mode === 'higher-lower') {
      const [a, b] = q.options;
      const win = a.value > b.value ? a.id : b.id;
      if (win !== q.answerId) { bad++; continue; }                   // stated answer must match the numbers
    }
    if (q.mode === 'career-path' && q.clubs.length < 3) bad++;
  }
  console.log(`${key.padEnd(14)} generated ${String(made).padStart(3)}/300  malformed ${bad}  distinct answers ${seenAnswers.size}`);
  fails += bad;
}

const round = buildRound(db, mulberry32(7), Object.keys(MODES), 10);
console.log(`\ndaily round: ${round.length} questions, modes = ${[...new Set(round.map(q => q.mode))].join(', ')}`);
const r2 = buildRound(db, mulberry32(7), Object.keys(MODES), 10);
console.log(`deterministic: ${JSON.stringify(round.map(q=>q.answerId)) === JSON.stringify(r2.map(q=>q.answerId)) ? 'YES' : 'NO'}`);
console.log(fails === 0 ? '\nPASS - no malformed questions' : `\nFAIL - ${fails} malformed`);
process.exit(fails === 0 ? 0 : 1);
