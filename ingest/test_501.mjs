import { readFileSync } from 'fs';
globalThis.fetch = async () => ({ ok:true, json: async () =>
  JSON.parse(readFileSync('app/data/dataset.json','utf8')) });
const { loadData } = await import('../app/js/data.js');
const { buildNameIndex, lookup } = await import('../app/js/names.js');
const F = await import('../app/js/engine/football501.js');

const db = await loadData();
const idx = buildNameIndex(db.players);
let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL ' + m); fail++; } else console.log('  ok   ' + m); };

console.log('=== name matching (typed from memory, on a phone) ===');
for (const [q, want] of [['giggs','Ryan Giggs'],['Giggs','Ryan Giggs'],['ryan giggs','Ryan Giggs'],
  ['ibrahimovic','Zlatan Ibrahimović'],['van nistelrooy','Ruud van Nistelrooy'],
  ['gerrard','Steven Gerrard'],['scholse','Paul Scholes'],
  ['steven gerard','Steven Gerrard'],['bekham','David Beckham']]) {
  const r = lookup(idx, q);
  ok(r && r.name === want, `"${q}" -> ${r ? r.name : 'null'}${r&&r.name!==want?` (wanted ${want})`:''}`);
}

console.log('\n=== Chelsea, appearances (verified figures) ===');
const g = F.createGame({ club:'Chelsea F.C.', metric:'apps', names:['Jon','James'] });
const say = (n) => { const r = F.scoreEntry(db, idx, g, n);
  console.log(`  ${g.players[g.turn].name.padEnd(6)} "${n}" -> ${r.status.padEnd(11)} raw=${r.raw ?? '-'} score=${r.score}  | ${F.explain(r,'appearances')}`);
  F.applyTurn(g, r); return r; };

const r1 = say('Zola');                        // 312 - large scores now count
ok(r1.status === 'ok' && r1.score === r1.raw, `Zola (${r1.raw}) counts in full, no maximum visit`);
const r2 = say('Madueke');
ok(r2.raw > 0 && r2.raw <= 180, `Madueke returns a usable number (${r2.raw})`);
// This used to assert the opposite. Club rosters come from Wikipedia and were
// far bigger than our player set, so a club's record holder was often not a
// nameable player - Ron Harris made 795 for Chelsea and was simply absent.
// Widening the extract past the famous few closed that gap, and the assertion
// now guards against it reopening.
const rHarris = F.scoreEntry(db, idx, g, 'Ron Harris');
ok(rHarris.status !== 'unknown',
   `Chelsea record holder Ron Harris is nameable (${rHarris.status})`);
const r3 = say('Ryan Giggs');                  // never played for Chelsea
ok(r3.status === 'ineligible', 'Giggs rejected as ineligible for Chelsea');
const r4 = say('Zola');
ok(r4.status === 'duplicate', 'Zola cannot be named twice');
const r5 = say('Zibblewick Nonesuch');
ok(r5.status === 'unknown', 'nonsense name rejected');

console.log('\n=== checkout + bust ===');
const g2 = F.createGame({ club:'Arsenal F.C.', metric:'apps', names:['A'] });
g2.players[0].score = 40;
const roster = [...F.rosterOf(db,'Arsenal F.C.')].map(id => db.byId.get(id))
  .filter(p => { const v = F.valueFor(p,'Arsenal F.C.','apps'); return v>0 && v<=180; });
const near = roster.find(p => { const v=F.valueFor(p,'Arsenal F.C.','apps'); return v>=40 && v<=50; });
if (near) {
  const r = F.scoreEntry(db, idx, g2, near.name);
  console.log(`  on 40, named ${near.name} (${r.raw}) -> ${r.status}`);
  ok(['win','bust'].includes(r.status), 'near-checkout resolves to win or bust');
}
const g3 = F.createGame({ club:'Arsenal F.C.', metric:'apps', names:['A'] });
g3.players[0].score = 5;
const big = roster.find(p => F.valueFor(p,'Arsenal F.C.','apps') > 100);
const rb = F.scoreEntry(db, idx, g3, big.name);
ok(rb.status === 'bust', `on 5, ${big.name} (${rb.raw}) busts rather than going below -10`);

console.log('\n=== playable depth ===');
for (const c of ['Chelsea F.C.','Arsenal F.C.','Celtic F.C.','Liverpool F.C.']) {
  const r = [...F.rosterOf(db,c)].map(id=>db.byId.get(id));
  const usable = r.filter(p => { const v=F.valueFor(p,c,'apps'); return v>0 && v<=180; });
  console.log(`  ${c.padEnd(24)} ${String(r.length).padStart(3)} players, ${String(usable.length).padStart(3)} score under 180`);
}

console.log('=== bust, pass, hints, start value ===');
{
  const clubs = F.clubsWithDepth(db, 15);
  const club = clubs.find(c => c.name === 'Arsenal F.C.') || clubs[0];
  const g = F.createGame({ club: club.name, metric: 'goals', scope: 'all',
                           names: ['A', 'B'], start: 301, hints: 3, turnSeconds: 30 });
  ok(g.players[0].score === 301, 'a game can start from 301');
  ok(g.players.every(p => p.hints === 3), 'each player gets their own hint allowance');

  // overshoot: the score must come back to exactly where the turn began
  g.players[0].score = 5;
  const roster = [...F.rosterOf(db, club.name)].map(id => db.byId.get(id));
  const big = roster.find(p => F.valueFor(p, club.name, 'goals', 'all') > 50);
  const bust = F.scoreEntry(db, idx, g, big.name);
  ok(bust.status === 'bust', `overshooting busts (${big.name})`);
  ok(bust.back === 5, 'the result carries the score to revert to');
  F.applyTurn(g, bust);
  ok(g.players[0].score === 5, 'a bust leaves the score untouched');
  ok(g.turn === 1, 'and the turn passes');

  // exact finish only
  g.turn = 0;
  const exact = roster.find(p => !g.used.has(p.id) && F.valueFor(p, club.name, 'goals', 'all') === 5);
  if (exact) {
    const w = F.scoreEntry(db, idx, g, exact.name);
    ok(w.status === 'win', `landing exactly on nothing wins (${exact.name})`);
  } else {
    ok(false, 'expected somebody on exactly 5 goals for a club this size');
  }

  const g2 = F.createGame({ club: club.name, metric: 'goals', scope: 'all', names: ['A', 'B'] });
  const before = g2.players[0].score;
  F.passTurn(g2);
  ok(g2.players[0].score === before && g2.turn === 1, 'a pass costs the turn, not the score');

  const opts = F.hintOptions(db, g2, Math.random);
  ok(opts && opts.length === 4, 'a hint deals four eligible players');
  ok(opts.every(o => F.rosterOf(db, club.name).has(o.id)), 'all four played for the club');
  g2.players[1].score = 3;
  g2.turn = 1;
  const safe = F.hintOptions(db, g2, Math.random)
    .some(o => F.valueFor(db.byId.get(o.id), club.name, 'goals', 'all') <= 3);
  ok(safe, 'at least one of the four will not bust you');
}


console.log('=== the international game ===');
{
  const teams = F.teamsWithDepth(db, 25);
  ok(teams.length > 30, `${teams.length} national sides deep enough to play`);
  ok(teams.some(t => t.name === 'England') && teams.some(t => t.name === 'Germany'),
     'England and Germany are among them');
  ok(!teams.some(t => /national|under-|olympic/i.test(t.name)),
     'they are named as countries, not as "X national football team"');

  const g = F.createGame({ club: 'England', kind: 'country', metric: 'goals',
                           names: ['A', 'B'], start: 501 });
  const kane = F.scoreEntry(db, idx, g, 'Harry Kane');
  ok(kane.status === 'ok' && kane.raw === 85, `Kane scores his England goals (${kane.raw})`);

  // A club career must not leak into an international leg, and the other way round
  const messi = F.scoreEntry(db, idx, g, 'Lionel Messi');
  ok(messi.status === 'ineligible', 'an Argentina player is ineligible for England');
  const cahill = db.players.find(p => p.name === 'Tim Cahill');
  ok(F.valueFor(cahill, 'Australia', 'apps', 'all', 'country') === 108 &&
     F.valueFor(cahill, 'Samoa', 'apps', 'all', 'country') === 2,
     'caps are counted per country, not per career');

  // a keeper with no international goals is a real zero, not missing data
  const shilton = F.scoreEntry(db, idx, g, 'Peter Shilton');
  ok(shilton.status === 'ok' && shilton.raw === 0, 'a goalkeeper scores a genuine nothing');

  const caps = F.createGame({ club: 'Germany', kind: 'country', metric: 'apps',
                              names: ['A', 'B'], start: 501 });
  const muller = F.scoreEntry(db, idx, caps, 'Thomas Müller');
  ok(muller.status === 'ok' && muller.raw === 131, `caps score for Germany (${muller.raw})`);
  ok(F.scoreEntry(db, idx, caps, 'Thomas Muller').raw === 131,
     'and the name resolves without the umlaut');
}


console.log('=== give up, solo, and the throw limit ===');
{
  const g = F.createGame({ club: 'Arsenal F.C.', metric: 'goals', names: ['Jon', 'Rich'], start: 501 });
  g.players[0].score = 17; g.players[1].score = 3;
  F.giveUp(g);
  ok(g.finished && g.abandoned, 'giving up ends the round and says so');
  ok(g.players[g.winner].name === 'Rich', 'the lowest score takes an abandoned leg');
  const cs = F.checkouts(db, g);
  ok(cs.length === 2 && cs[0].score === 17, 'checkouts are reported per player');
  ok(cs[0].names.length > 0 && cs[0].names.every(n => {
    const p = db.players.find(x => x.name === n);
    return F.valueFor(p, 'Arsenal F.C.', 'goals', 'all') === 17;
  }), `everyone listed for 17 is on exactly 17 (${cs[0].names.slice(0,3).join(', ')})`);

  const used = F.createGame({ club: 'Arsenal F.C.', metric: 'goals', names: ['A'], start: 501 });
  used.players[0].score = 17;
  const first = F.checkouts(db, used)[0].names[0];
  used.used.add(db.players.find(p => p.name === first).id);
  ok(!F.checkouts(db, used)[0].names.includes(first), 'a player already thrown is not offered as a checkout');
}
{
  const solo = F.createGame({ club: 'Arsenal F.C.', metric: 'goals', names: ['Jon'], start: 301 });
  ok(solo.players.length === 1, 'a solo leg is one player');
  F.applyTurn(solo, { status: 'ok', player: { id: 'x', name: 'y' }, raw: 10, score: 10 });
  ok(solo.turn === 0 && solo.players[0].score === 291, 'the turn comes straight back round');
}
{
  const g = F.createGame({ club: 'Arsenal F.C.', metric: 'goals', names: ['A', 'B'],
                           start: 501, limit: 10 });
  ok(F.throwsLeft(g) === 10, 'ten throws each to start');
  for (let i = 0; i < 20; i++) {
    if (g.finished) break;
    F.applyTurn(g, { status: 'ok', player: { id: 'p' + i, name: 'n' }, raw: i < 10 ? 5 : 1, score: i < 10 ? 5 : 1 });
  }
  ok(g.finished && g.onLimit, 'the leg ends when both have had their ten');
  ok(g.players.every(p => p.history.length === 10), 'and not before either has');
  ok(g.players[g.winner].score === Math.min(...g.players.map(p => p.score)),
     'the lowest score wins on the count-back');

  const tie = F.createGame({ club: 'Arsenal F.C.', metric: 'goals', names: ['A', 'B'],
                             start: 501, limit: 1 });
  F.applyTurn(tie, { status: 'ok', player: { id: 'a', name: 'a' }, raw: 5, score: 5 });
  F.applyTurn(tie, { status: 'ok', player: { id: 'b', name: 'b' }, raw: 5, score: 5 });
  ok(tie.finished && tie.drawn, 'level scores are reported as a tie, not a win');

  const unl = F.createGame({ club: 'Arsenal F.C.', metric: 'goals', names: ['A'], start: 501 });
  ok(F.throwsLeft(unl) === null, 'with no limit there is nothing to count down');
}

console.log(fail ? `\nFAIL (${fail})` : '\nPASS');
process.exit(fail?1:0);