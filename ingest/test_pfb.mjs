import { readFileSync } from 'fs';
globalThis.fetch = async () => ({ ok:true, json: async () => JSON.parse(readFileSync('app/data/dataset.json','utf8')) });
const { loadData } = await import('../app/js/data.js');
const { buildNameIndex } = await import('../app/js/names.js');
const { mulberry32 } = await import('../app/js/rng.js');
const P = await import('../app/js/engine/playedForBoth.js');
const db = await loadData(), idx = buildNameIndex(db.players);
let fail=0; const ok=(c,m)=>{ if(!c){console.log('  FAIL '+m);fail++;} else console.log('  ok   '+m); };

console.log('=== board generation ===');
const rnd = mulberry32(99); let made=0, bad=0;
for (let i=0;i<200;i++){
  const b=P.generate(db,rnd); if(!b){continue;} made++;
  if (b.answerIds.length!==b.count) bad++;
  if (b.count<5||b.count>15) bad++;
  if (b.left.key===b.right.key) bad++;
  // every listed answer must genuinely belong to both sides
  for (const id of b.answerIds){
    const p=db.byId.get(id);
    const l=p.clubs.some(c=>c.club===b.left.key);
    const r=b.right.kind==='country' ? p.nationality===b.right.key : p.clubs.some(c=>c.club===b.right.key);
    if(!l||!r){bad++;break;}
  }
}
console.log(`  generated ${made}/200, malformed ${bad}`);
ok(bad===0,'every board is well-formed and every answer verified on both sides');

console.log('\n=== playing a board ===');
const b=P.generate(db,mulberry32(7));
console.log(`  ${b.left.label} × ${b.right.label} — ${b.count} players`);
const g=P.createGame(b);
const first=db.byId.get(b.answerIds[0]).name;
let r=P.guess(db,idx,g,first); P.apply(g,r);
ok(r.status==='hit' && g.found.size===1, `"${first}" fills a slot`);
r=P.guess(db,idx,g,first); P.apply(g,r);
ok(r.status==='already', 'same player cannot be used twice');
ok(g.lives===P.LIVES, 'a repeat does not cost a life');
r=P.guess(db,idx,g,'Zibblewick Nonesuch'); P.apply(g,r);
ok(r.status==='unknown' && g.lives===P.LIVES, 'a name we do not hold costs no life (our gap, not their error)');
const onlyLeft=db.players.find(p=>p.clubs.some(c=>c.club===b.left.key) && !b.answerIds.includes(p.id));
if(onlyLeft){ r=P.guess(db,idx,g,onlyLeft.name); P.apply(g,r);
  ok(r.status==='one-side' && g.lives===P.LIVES-1, `"${onlyLeft.name}" -> ${P.explain(r,b)}`); }
console.log('\n=== clearing it ===');
const g2=P.createGame(b);
for(const id of b.answerIds){ const rr=P.guess(db,idx,g2,db.byId.get(id).name); P.apply(g2,rr); }
ok(g2.finished && g2.found.size===b.count, `named all ${b.count} -> board cleared`);
console.log(fail?`\nFAIL (${fail})`:'\nPASS'); process.exit(fail?1:0);
