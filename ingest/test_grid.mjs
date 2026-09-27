import { readFileSync } from 'fs';
globalThis.fetch = async () => ({ ok:true, json: async () => JSON.parse(readFileSync('app/data/dataset.json','utf8')) });
const { loadData } = await import('../app/js/data.js');
const { buildNameIndex, lookup } = await import('../app/js/names.js');
const { mulberry32 } = await import('../app/js/rng.js');
const G = await import('../app/js/engine/grid.js');
const db = await loadData(), idx = buildNameIndex(db.players);
let fail = 0; const ok = (c, m) => { if (!c) { console.log('  FAIL ' + m); fail++; } else console.log('  ok   ' + m); };

const cats = G.categories(db);
ok(cats.length >= 40, `${cats.length} categories available`);
ok(cats.every(c => c.ids.size >= 12), 'no category is too thin to use');

// The whole point of pre-checking squares: a grid nobody can finish is worse
// than no grid. Every square of every grid must be answerable by name.
console.log('=== 300 grids, every square answered by name ===');
const rnd = mulberry32(2024);
let made = 0, thin = 0, unanswerable = 0, incomplete = 0;
for (let i = 0; i < 300; i++) {
  const grid = G.generate(db, rnd, { cats });
  if (!grid) continue;
  made++;
  for (const row of grid.cells) for (const s of row) if (s.size < 3) thin++;
  const game = G.createGame(grid);
  const rev = G.reveal(db, game);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const res = G.submit(db, idx, game, r, c, rev[r][c] || '', lookup);
    if (res.status !== 'ok') unanswerable++;
    G.apply(game, res, r, c);
  }
  if (G.filledCount(game) !== 9) incomplete++;
}
ok(made === 300, `${made} of 300 grids generated`);
ok(thin === 0, `no square with fewer than 3 answers (${thin})`);
ok(unanswerable === 0, `every revealed answer validates (${unanswerable} failures)`);
ok(incomplete === 0, `every grid completable in 9 (${incomplete} failures)`);

console.log('=== rules ===');
const grid = G.generate(db, mulberry32(5), { cats });
let game = G.createGame(grid);
const rev = G.reveal(db, game);
G.apply(game, G.submit(db, idx, game, 0, 0, rev[0][0], lookup), 0, 0);
ok(game.left === G.GUESSES - 1, 'a correct answer costs a guess');
ok(game.filled[0][0], 'the square is filled');
const again = G.submit(db, idx, game, 0, 1, rev[0][0], lookup);
ok(again.status === 'used', 'the same player cannot be used twice');
const nobody = G.submit(db, idx, game, 1, 1, 'Zzzz Noone', lookup);
ok(nobody.status === 'no-player', 'an unknown name is rejected');
game = G.createGame(grid);
for (let i = 0; i < G.GUESSES; i++) G.apply(game, { status: 'wrong' }, 1, 1);
ok(game.finished, 'nine wrong guesses ends it');

console.log(fail ? `test_grid          FAIL (${fail})` : 'test_grid          PASS');
process.exit(fail ? 1 : 0);
