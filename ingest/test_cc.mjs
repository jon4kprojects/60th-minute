import { readFileSync } from 'fs';
globalThis.fetch = async (u) => ({ ok: true, json: async () =>
  JSON.parse(readFileSync(String(u).includes('world') ? 'app/data/world.json'
                                                     : 'app/data/dataset.json', 'utf8')) });
const { loadData, loadWorld } = await import('../app/js/data.js');
const { mulberry32 } = await import('../app/js/rng.js');
const CC = await import('../app/js/engine/countryConundrum.js');
const db = await loadData(), world = await loadWorld();
let fail = 0; const ok = (c, m) => { if (!c) { console.log('  FAIL ' + m); fail++; } else console.log('  ok   ' + m); };

console.log('=== the map ===');
ok(world.placed.size > 150, `${world.placed.size} countries drawn`);
for (const n of ['England', 'Scotland', 'Wales', 'Northern Ireland'])
  ok(world.placed.has(n), `${n} is its own shape, not folded into the UK`);
ok(!world.placed.has('Yugoslavia'), 'a vanished state is not a target');

console.log('=== clubs and answers ===');
const choices = CC.clubChoices(db, world.placed, CC.TARGET);
ok(choices.length > 100, `${choices.length} clubs have ${CC.TARGET}+ countries`);
ok(choices.every(c => c.n >= CC.TARGET), 'none is offered that cannot be finished');

const ans = CC.answersFor(db, 'Everton F.C.', world.placed);
ok(ans.size >= 30, `Everton: ${ans.size} countries`);
ok((ans.get('Australia') || []).includes('Tim Cahill'), 'Australia reveals Cahill');
ok((ans.get('Nigeria') || []).includes('Yakubu'), 'Nigeria reveals Yakubu');
ok([...ans.keys()].every(c => world.placed.has(c)), 'every answer is a country the map can draw');

console.log('=== rules ===');
{
  const g = CC.createGame({ club: 'Everton F.C.', answers: ans });
  ok(CC.guess(g, 'Australia').status === 'correct', 'a correct country turns up correct');
  ok(g.guesses === 1, 'and costs one guess');
  ok(CC.guess(g, 'Australia').status === 'already', 'the same country cannot be scored twice');
  ok(g.guesses === 1, 'and a repeat costs nothing');
  const w = CC.guess(g, 'Mongolia');
  ok(w.status === 'wrong' && g.guesses === 2, 'a miss costs a guess');
  ok(CC.guess(g, 'Mongolia').status === 'already', 'a red country stays red and cannot be respent');
  ok(g.guesses === 2, 'still two guesses');
  ok(CC.accuracy(g) === 50, `accuracy is correct over total (${CC.accuracy(g)}%)`);

  // 30 of 30 ends it, and nothing scores afterwards
  for (const c of CC.remaining(g)) { if (!g.finished) CC.guess(g, c); }
  ok(g.finished && g.found.size === g.target, `the round ends at ${g.target}`);
  ok(CC.guess(g, 'Brazil').status === 'over', 'no guess counts after the final one');
}

console.log('=== every playable club is actually finishable ===');
{
  const rnd = mulberry32(7);
  let bad = 0;
  for (let i = 0; i < 60; i++) {
    const c = CC.pickClub(choices, rnd);
    const a = CC.answersFor(db, c.name, world.placed);
    if (a.size < CC.TARGET) bad++;
    for (const [country, players] of a)
      if (!world.placed.has(country) || !players.length) bad++;
  }
  ok(bad === 0, `60 dealt clubs all hold ${CC.TARGET} drawable countries with named players`);
}

console.log(fail ? `test_cc            FAIL (${fail})` : 'test_cc            PASS');
process.exit(fail ? 1 : 0);
