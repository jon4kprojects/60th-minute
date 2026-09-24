// Regression tests for the class of bug that hid Demba Ba's West Ham spell.
//
// The failure was not a wrong number, it was a missing FACT, and our other
// checks could not see it: they looked for clubs we wrongly claimed, never for
// clubs we had silently lost. These tests assert the opposite direction.
import { readFileSync } from 'fs';
globalThis.fetch = async () => ({ ok:true, json: async () =>
  JSON.parse(readFileSync('app/data/dataset.json','utf8')) });
const { loadData } = await import('../app/js/data.js');
const { buildNameIndex, lookup } = await import('../app/js/names.js');
const db = await loadData();
const idx = buildNameIndex(db.players);
let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL ' + m); fail++; } else console.log('  ok   ' + m); };

// 1. Structural invariant. Career-path display is a FILTERED view of
//    membership, so anything shown must also be known. If these ever diverge,
//    a filter has leaked into the fact layer again.
let leaks = 0, leakEg = [];
for (const p of db.players) {
  const all = new Set(p.allClubs || []);
  for (const c of p.clubs) if (!all.has(c.club)) {
    leaks++; if (leakEg.length < 3) leakEg.push(`${p.name} / ${c.club}`);
  }
}
ok(leaks === 0, `every displayed club is also a known club (${leaks} leaks${leakEg.length ? ': ' + leakEg.join(', ') : ''})`);

// 2. Membership must never be empty for a player we publish.
const empty = db.players.filter(p => !(p.allClubs || []).length);
ok(empty.length === 0, `no player has empty club membership (${empty.length} found)`);

// 3. Known pairs that the old filter deleted. Each is a real spell, several
//    short, and every one must resolve through the same path the games use.
const MUST_KNOW = [
  ['Demba Ba',          'West Ham United F.C.'],      // 12 games - the reported bug
  ['Javier Mascherano', 'West Ham United F.C.'],      // 5 games
  ['Mohamed Salah',     'Chelsea F.C.'],              // 13 games
  ['Kevin De Bruyne',   'Chelsea F.C.'],              // no apps recorded upstream
  ['Kevin De Bruyne',   'Manchester City F.C.'],      // no apps recorded upstream
  ["Samuel Eto'o",      'Everton F.C.'],
  ['David Beckham',     'Preston North End F.C.'],
  ['Marcus Rashford',   'Aston Villa F.C.'],
];
for (const [name, club] of MUST_KNOW) {
  const p = lookup(idx, name);
  const known = p && (p.allClubs || []).includes(club);
  ok(known, `${name} is known to have played for ${club.replace(/ (F\.C\.|A\.F\.C\.)$/, '')}`);
}

// 4. The same fact via the club index the games actually query, so a bug in
//    the index cannot pass while the player record looks fine.
for (const [name, club] of MUST_KNOW.slice(0, 4)) {
  const p = lookup(idx, name);
  const roster = db.byClub.get(club);
  ok(roster && roster.has(p.id), `club index for ${club.replace(/ F\.C\.$/, '')} contains ${name}`);
}

// 5. Career paths must not lose a club merely because upstream recorded no
//    appearance figure. Absence of a statistic is not absence of a spell.
const dbr = lookup(idx, 'Kevin De Bruyne');
ok(dbr.clubs.some(c => c.club === 'Manchester City F.C.'),
   'a spell with no appearance figure still appears in the career path');

console.log(fail ? `\nFAIL (${fail})` : '\nPASS');
process.exit(fail ? 1 : 0);
