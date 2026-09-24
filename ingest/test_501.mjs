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

const r1 = say('Zola');                        // 312 -> over 180 -> 0
ok(r1.status === 'over-max' && r1.score === 0, `Zola (${r1.raw}) scores 0, over the 180 max`);
const r2 = say('Madueke');
ok(r2.raw > 0 && r2.raw <= 180, `Madueke returns a usable number (${r2.raw})`);
// Coverage gap worth keeping visible: club rosters come from Wikipedia and are
// far bigger than our Wikidata-derived player set, so a club's record holder
// may not be a nameable player. Ron Harris made 795 for Chelsea and is absent.
const rHarris = F.scoreEntry(db, idx, g, 'Ron Harris');
ok(rHarris.status === 'unknown',
   'known gap: Chelsea record holder Ron Harris is not in our player set');
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
console.log(fail ? `\nFAIL (${fail})` : '\nPASS');
process.exit(fail?1:0);
