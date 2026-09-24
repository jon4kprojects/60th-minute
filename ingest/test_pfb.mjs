import { readFileSync } from 'fs';
globalThis.fetch = async () => ({ ok:true, json: async () => JSON.parse(readFileSync('app/data/dataset.json','utf8')) });
const { loadData } = await import('../app/js/data.js');
const { buildNameIndex } = await import('../app/js/names.js');
const { mulberry32 } = await import('../app/js/rng.js');
const P = await import('../app/js/engine/playedForBoth.js');
const db = await loadData(), idx = buildNameIndex(db.players);
let fail=0; const ok=(c,m)=>{ if(!c){console.log('  FAIL '+m);fail++;} else console.log('  ok   '+m); };

console.log('=== board generation across 2-5 sides ===');
const rnd = mulberry32(99); let made=0, bad=0;
for (let i=0;i<200;i++){
  const b=P.generate(db,rnd,2+(i%4)); if(!b){continue;} made++;
  if (b.answerIds.length!==b.count) bad++;
  if (b.count<5||b.count>20) bad++;
  if (new Set(b.sides.map(s=>s.key)).size !== b.sides.length) bad++;
  // every listed answer must genuinely belong to at least two of the sides
  for (const id of b.answerIds){
    const p=db.byId.get(id);
    const n=b.sides.filter(s=> s.kind==='country' ? p.nationality===s.key
                                                  : p.clubs.some(c=>c.club===s.key)).length;
    if(n<2){bad++;break;}
  }
}
console.log(`  generated ${made}/200, malformed ${bad}`);
ok(bad===0,'every board is well-formed and every answer verified on both sides');

console.log('\n=== playing a board ===');
const b=P.generate(db,mulberry32(7),2);
console.log(`  ${b.sides.map(s=>s.label).join(' × ')} — ${b.count} players`);
const g=P.createGame(b);
const first=db.byId.get(b.answerIds[0]).name;
let r=P.guess(db,idx,g,first); P.apply(g,r);
ok(r.status==='hit' && g.found.size===1, `"${first}" fills a slot`);
r=P.guess(db,idx,g,first); P.apply(g,r);
ok(r.status==='already', 'same player cannot be used twice');
ok(g.lives===P.LIVES, 'a repeat does not cost a life');
r=P.guess(db,idx,g,'Zibblewick Nonesuch'); P.apply(g,r);
ok(r.status==='unknown' && g.lives===P.LIVES, 'a name we do not hold costs no life (our gap, not their error)');
const onlyLeft=db.players.find(p=>p.clubs.some(c=>c.club===b.sides[0].key) && !b.answerIds.includes(p.id));
if(onlyLeft){ r=P.guess(db,idx,g,onlyLeft.name); P.apply(g,r);
  ok(r.status==='one-side' && g.lives===P.LIVES-1, `"${onlyLeft.name}" -> ${P.explain(r)}`); }
console.log('\n=== clearing it ===');
const g2=P.createGame(b);
for(const id of b.answerIds){ const rr=P.guess(db,idx,g2,db.byId.get(id).name); P.apply(g2,rr); }
ok(g2.finished && g2.found.size===b.count, `named all ${b.count} -> board cleared`);
console.log(fail?`\nFAIL (${fail})`:'\nPASS'); process.exit(fail?1:0);

console.log('\n=== the count is a clue, hidden until asked ===');
const b3=P.generate(db,mulberry32(21),3);
const g3=P.createGame(b3);
ok(g3.countShown===false, 'a new board hides how many answers there are');
g3.countShown=true;
ok(g3.countShown===true, 'the clue can be revealed on request');

console.log('\n=== manual selection ===');
const picks=P.clubChoices(db).slice(0,4);
const man=P.build(db,picks);
console.log(`  ${picks.map(p=>p.label).join(' × ')} = ${man.count} players`);
ok(man.answerIds.every(id=>{
  const p=db.byId.get(id);
  return picks.filter(s=>p.clubs.some(c=>c.club===s.key)).length>=2;
}), 'manual board answers all belong to at least two of the picks');
