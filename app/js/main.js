import { loadData, checkForUpdate } from './data.js';
import { MODES, buildRound } from './engine/index.js';
import { mulberry32, seedFrom } from './rng.js';
import { buildNameIndex, suggest } from './names.js';
import * as F501 from './engine/football501.js';
import * as PFB from './engine/playedForBoth.js';

const BUILD = 'b27.7a03009';
const app = document.getElementById('app');
const el = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const shortClub = (n) => n.replace(/\s+(F\.?C\.?|A\.?F\.?C\.?|S\.?C\.?|C\.?F\.?)$/i,'')
  .replace(/^(F\.?C\.?|A\.?F\.?C\.?|S\.?C\.?|C\.?F\.?)\s+/i,'').replace(/\s+Club de Fútbol$/i,'').trim();

// Installing is the one step friends get stuck on, and it differs by phone:
// on iPhone only Safari can add to the home screen, and the option is buried
// in the Share sheet. Chrome and Android offer a real install prompt instead.
const platform = () => {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  return 'other';
};
const installed = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });

const store = {
  get best() { try { return +localStorage.getItem('best') || 0; } catch { return 0; } },
  set best(v) { try { localStorage.setItem('best', v); } catch {} },
  doneToday() { try { return localStorage.getItem('daily') === today(); } catch { return false; } },
  markToday() { try { localStorage.setItem('daily', today()); } catch {} },
  get hideInstall() { try { return localStorage.getItem('noinstall') === '1'; } catch { return false; } },
  set hideInstall(v) { try { localStorage.setItem('noinstall', v ? '1' : ''); } catch {} },
};

let DB = null, NAMES = null, S = null, G = null;

// Installed to a home screen there is no browser back button, and on Android
// the hardware one would otherwise quit the app from the first screen you open.
// Each screen pushes a history entry so Back steps home instead of exiting.
let atHome = true;
function enterScreen() {
  if (atHome) { try { history.pushState({ m60: 1 }, ''); } catch {} }
  atHome = false;
}
window.addEventListener('popstate', () => { if (!atHome) home(); });

/* ---------------- home ---------------- */
function home() {
  atHome = true;
  const offline = navigator.serviceWorker?.controller;
  app.innerHTML = '';
  app.append(el(`<div>
    <img class="logo" src="./brand/logo-lockup.svg" width="250" alt="60th Minute">
    <div class="tag">${DB.players.length.toLocaleString()} players · 1940s to today</div>
    <div class="dataver">Build ${esc(BUILD)} · data ${esc(DB.version)}</div>
    <button class="card hot" data-go="f501">
      <div class="t">Football 501</div><div class="b">Darts, with footballers · 2–4 players</div></button>
    <button class="card hot" data-go="pfb">
      <div class="t">Played for Both</div><div class="b">Clear the board · name every shared player</div></button>
    ${Object.entries(MODES).map(([k, m]) => `
      <button class="card" data-go="${k}"><div class="t">${m.title}</div><div class="b">${m.blurb}</div></button>`).join('')}
    <button class="card" data-go="daily">
      <div class="t">Daily Challenge ${store.doneToday() ? '✓' : ''}</div>
      <div class="b">10 questions · same for everyone today</div></button>
    <div class="spacer"></div>
    <div class="badge ${offline ? 'on' : ''}"><i class="dot"></i>${offline ? 'Offline ready' : 'Caching…'}</div>
    ${installHint()}
    ${store.best ? `<div class="tag" style="margin-top:10px">Best score ${store.best}</div>` : ''}
  </div>`));
  const hide = document.getElementById('hideinstall');
  if (hide) hide.onclick = () => { store.hideInstall = true; home(); };
  const doInstall = document.getElementById('doinstall');
  if (doInstall) doInstall.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null; home();
  };
  app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    const g = b.dataset.go;
    if (g === 'f501') return setup501();
    if (g === 'pfb') return setupPFB();
    start(g);
  });
}

function installHint() {
  if (installed() || store.hideInstall) return '';
  const p = platform();
  const how = p === 'ios-safari'
    ? 'Tap <b>Share</b>, then <b>Add to Home Screen</b>.'
    : p === 'ios-other'
      ? 'Open this page in <b>Safari</b>, then Share \u2192 <b>Add to Home Screen</b>. Only Safari can install it on iPhone.'
      : 'Tap the menu, then <b>Install app</b> \u2014 or use the button below.';
  return `<div class="install">
    <div class="t">Put it on your home screen</div>
    <div class="d">${how} It then works with no signal at all.</div>
    ${p === 'other' && deferredPrompt ? '<button class="btn" id="doinstall">Install</button>' : ''}
    <button class="x" id="hideinstall">Not now</button>
  </div>`;
}

/* ---------------- Football 501 ---------------- */
function setup501() {
  enterScreen();
  const clubs = F501.clubsWithDepth(DB, 15).slice()
    .sort((a, b) => shortClub(a.name).localeCompare(shortClub(b.name)));   // alphabetical
  let club = null, metric = 'goals', scope = 'all', n = 2, filter = '';

  // Every control redraws the whole panel, so typed names must survive it.
  // Without this, changing the metric or player count silently wiped them.
  const redraw = () => {
    const names = [...app.querySelectorAll('.nm')].map(i => i.value);
    draw();
    [...app.querySelectorAll('.nm')].forEach((i, k) => { if (names[k]) i.value = names[k]; });
  };

  const draw = () => {
    const hasLg = club ? F501.hasLeagueSplit(DB, club) : false;
    if (!hasLg) scope = 'all';
    const shown = clubs.filter(c => shortClub(c.name).toLowerCase().includes(filter.toLowerCase()));
    app.innerHTML = '';
    app.append(el(`<div>
      <div class="bar"><button class="back" id="back">‹ Back</button></div>
      <div class="kicker">Football 501</div>
      <h1 style="font-size:30px">Set up the <em>oche</em></h1>
      <div class="tag">Everyone starts on 501. Name players who turned out for the club —
        their number comes off your score. Go below zero and you bust.</div>

      <label>Club</label>
      <input id="clubq" placeholder="Type a club" value="${esc(filter)}"
        autocomplete="off" autocorrect="off" spellcheck="false">
      <div class="sugg" id="clublist" hidden></div>
      ${club && !filter ? `<div class="chosen">${esc(shortClub(club))}<button class="x" id="clear">change</button></div>` : ''}

      <label>Score by</label>
      <div class="chips" id="metric">${Object.entries(F501.METRICS).map(([k, m]) =>
        `<button class="chip ${k === metric ? 'on' : ''}" data-m="${k}">${m.label}</button>`).join('')}</div>

      <label>Competitions</label>
      <div class="chips" id="scope">
        <button class="chip ${scope === 'all' ? 'on' : ''}" data-s="all">All competitions</button>
        <button class="chip ${scope === 'league' ? 'on' : ''} ${hasLg ? '' : 'off'}"
          data-s="league" ${hasLg ? '' : 'disabled'}>League only</button>
      </div>
      <div class="scopenote" style="margin-top:12px">
        ${scope === 'league'
          ? 'League appearances and goals only — no cups, no Europe.'
          : 'All competitions — league, cups and Europe.'}<br>
        <span>${scope === 'league' ? 'Wikipedia player infoboxes' : 'Wikipedia club player lists'} (CC BY-SA)</span>
      </div>

      <label>Players</label>
      <div class="chips" id="np">${[2,3,4].map(i =>
        `<button class="chip ${i === n ? 'on' : ''}" data-n="${i}">${i}</button>`).join('')}</div>
      <div id="names">${Array.from({length: n}, (_, i) =>
        `<input class="nm" placeholder="Player ${i+1}" style="margin-top:8px">`).join('')}</div>
      <button class="btn" id="go" ${club ? '' : 'disabled'}>${club ? 'Start' : 'Choose a club'}</button></div>`));

    document.getElementById('back').onclick = home;
    const q = document.getElementById('clubq');
    const box = document.getElementById('clublist');
    const clr = document.getElementById('clear');
    if (clr) clr.onclick = () => { club = null; filter = ''; draw(); };

    // Suggestions appear as you type; there is no preset list to pick from.
    const paintClubs = () => {
      const t = q.value.trim().toLowerCase();
      const hits = t.length < 1 ? []
        : clubs.filter(c => shortClub(c.name).toLowerCase().includes(t)).slice(0, 7);
      if (!hits.length) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      box.innerHTML = hits.map(c =>
        `<button class="sg" data-k="${esc(c.name)}">
           <span class="n">${esc(shortClub(c.name))}</span>
           <span class="m">${c.n} players</span></button>`).join('');
      box.querySelectorAll('.sg').forEach(b => b.onclick = () => {
        club = b.dataset.k; filter = ''; redraw();
      });
    };
    q.oninput = () => { filter = q.value; paintClubs(); };
    q.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      const first = box.querySelector('.sg');
      if (first) first.click();
    };
    if (filter) paintClubs();

    app.querySelectorAll('#scope .chip').forEach(c => c.onclick = () => {
      if (c.disabled) return; scope = c.dataset.s; redraw();
    });
    app.querySelectorAll('#metric .chip').forEach(c => c.onclick = () => { metric = c.dataset.m; redraw(); });
    app.querySelectorAll('#np .chip').forEach(c => c.onclick = () => { n = +c.dataset.n; redraw(); });
    document.getElementById('go').onclick = () => {
      const names = [...app.querySelectorAll('.nm')].map((i, k) => i.value.trim() || `Player ${k+1}`);
      G = F501.createGame({ club, metric, scope, names });
      play501();
    };
  };
  draw();
}

function play501(msg = null, tone = '') {
  const m = F501.METRICS[G.metric];
  app.innerHTML = '';
  app.append(el(`<div>
    <div class="bar"><button class="back" id="back">‹ Back</button>
      <span>${esc(shortClub(G.club))} · ${m.label} · ${esc(F501.SCOPES[G.scope||'all'].label)}</span></div>
    ${DB.statScope ? `<div class="scopeline">${esc(DB.statScope)}</div>` : ''}
    <div class="board">${G.players.map((p, i) => {
      const last = p.history[p.history.length - 1];
      return `<div class="seat ${i === G.turn && !G.finished ? 'active' : ''}">
        <div><div class="nm">${esc(p.name)}</div>
        ${last ? `<div class="last">${esc(last.name || 'no player')} · ${last.score || 0}</div>` : ''}</div>
        <div class="sc">${p.score}</div></div>`; }).join('')}</div>
    ${G.finished ? `
      <div class="fb"><div class="h ok">${esc(G.players[G.winner].name)} checks out!</div>
      <div class="d">Finished on ${G.players[G.winner].score}.</div></div>
      <button class="btn" id="again">Play again</button>
      <button class="btn ghost" id="home2">Home</button>`
    : `
      <div class="turnline"><b>${esc(G.players[G.turn].name)}</b> to throw — name ${/^[aeiou]/i.test(shortClub(G.club)) ? 'an' : 'a'} ${esc(shortClub(G.club))} player</div>
      <div class="entry"><input id="guess" placeholder="Player name" autocomplete="off"
        autocapitalize="words" autocorrect="off" spellcheck="false"
        ><button class="btn" id="submit">Score</button></div>
      <div class="sugg" id="sugg" hidden></div>
      ${msg ? `<div class="fb"><div class="h ${tone}">${esc(msg)}</div></div>` : ''}`}
    <ul class="log">${G.players.flatMap(p => p.history.map((h, i) => ({ p, h, i })))
      .sort((a, b) => b.i - a.i).slice(0, 12).map(({ p, h }) =>
        `<li><span class="who">${esc(p.name)}</span><span>${esc(h.name || '—')}</span>
        <span class="pts ${h.score ? '' : 'zero'}">${h.score || 0}</span></li>`).join('')}</ul>
  </div>`));
  document.getElementById('back').onclick = home;
  const again = document.getElementById('again'); if (again) again.onclick = setup501;
  const h2 = document.getElementById('home2'); if (h2) h2.onclick = home;
  const inp = document.getElementById('guess'), sub = document.getElementById('submit');
  if (inp) {
    const box = document.getElementById('sugg');
    let list = [], hi = -1;

    const paint = () => {
      if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      box.innerHTML = list.map((p, i) => `
        <button class="sg ${i === hi ? 'on' : ''}" data-i="${i}">
          <span class="n">${esc(p.name)}</span>
          <span class="m">${esc([p.nationality, p.position].filter(Boolean).join(' · '))}</span>
        </button>`).join('');
      box.querySelectorAll('.sg').forEach(b => b.onclick = () => {
        inp.value = list[b.dataset.i].name;   // fill, do not fire: a mis-tap
        list = []; hi = -1; paint();          // would burn a turn irreversibly
        inp.focus();
      });
    };

    inp.oninput = () => {
      list = suggest(NAMES, inp.value, 6); hi = -1; paint();
    };
    inp.onkeydown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!list.length) return;
        e.preventDefault();
        hi = e.key === 'ArrowDown'
          ? (hi + 1) % list.length
          : (hi - 1 + list.length) % list.length;
        paint();
      } else if (e.key === 'Enter') {
        if (hi >= 0 && list[hi]) { inp.value = list[hi].name; list = []; hi = -1; paint(); return; }
        go();
      } else if (e.key === 'Escape') { list = []; hi = -1; paint(); }
    };

    const go = () => {
      const v = inp.value.trim(); if (!v) return;
      const r = F501.scoreEntry(DB, NAMES, G, v);
      const tone = (r.status === 'ok' || r.status === 'win') ? 'ok' : 'no';
      F501.applyTurn(G, r);
      play501(F501.explain(r, F501.METRICS[G.metric].inline), tone);
    };
    sub.onclick = go;
    inp.focus();
  }
}

/* ---------------- Played for Both ---------------- */
let PB = null;

function setupPFB() {
  enterScreen();
  const clubs = PFB.clubChoices(DB);
  let mode = 'random', n = 2, chosen = [];

  const draw = () => {
    const picked = chosen.filter(Boolean);
    const more = PFB.compatibleClubs(DB, picked);
    const boardSize = picked.length >= 2
      ? PFB.build(DB, picked.map(k => clubs.find(c => c.key === k))).count : 0;

    app.innerHTML = '';
    app.append(el(`<div>
      <div class="bar"><button class="back" id="back">‹ Back</button></div>
      <div class="kicker">Played for Both</div>
      <h1 style="font-size:30px">Clear the <em>board</em></h1>
      <div class="tag">Name every player who turned out for <b>all</b> of the
        chosen clubs. Three lives.</div>

      <label>Clubs</label>
      <div class="chips" id="mode">
        <button class="chip ${mode === 'random' ? 'on' : ''}" data-m="random">Random</button>
        <button class="chip ${mode === 'pick' ? 'on' : ''}" data-m="pick">Choose my own</button>
      </div>

      ${mode === 'random' ? `
        <label>How many clubs</label>
        <div class="chips" id="n">
          ${[2, 3, 4, 5, 6].map(i =>
            `<button class="chip ${i === n ? 'on' : ''}" data-n="${i}">${i}</button>`).join('')}
          <button class="chip ${n === 'any' ? 'on' : ''}" data-n="any">Any</button>
        </div>
        <div class="tag" style="margin:8px 2px 0">Two clubs gives the longest board.
          More clubs means fewer players managed all of them — six is almost always
          a single answer.</div>`
      : `
        ${picked.map((k, i) => `
          <label>Club ${i + 1}</label>
          <div class="chosen">${esc(shortClub(k))}<button class="x" data-drop="${i}">remove</button></div>`).join('')}
        ${more.length ? `
          <label>${picked.length ? 'Add another club' : 'Club 1'}</label>
          <input class="clubslot" placeholder="Type a club"
            autocomplete="off" autocorrect="off" spellcheck="false">
          <div class="sugg" id="clubsugg" hidden></div>`
        : `<div class="tag" style="margin:10px 2px 0">No other club shares a player with these.</div>`}
        ${picked.length >= 2 ? `<div class="tag" style="margin:10px 2px 0">${
          boardSize >= PFB.BIG_BOARD
            ? `Big board — <b>${boardSize} players</b> to find, with three lives.`
            : `<b>${boardSize} player${boardSize === 1 ? '' : 's'}</b> turned out for all of these. Only clubs that keep at least one are offered, so the board is never empty.`
        }</div>` : ''}`}

      <button class="btn" id="go" ${mode === 'pick' && picked.length < 2 ? 'disabled' : ''}>
        ${mode === 'random' ? 'Play'
          : picked.length < 2 ? `Pick ${2 - picked.length} more`
          : `Play · ${picked.length} clubs`}</button>
    </div>`));

    document.getElementById('back').onclick = home;
    app.querySelectorAll('#mode .chip').forEach(c => c.onclick = () => { mode = c.dataset.m; draw(); });
    app.querySelectorAll('#n .chip').forEach(c => c.onclick = () => {
      n = c.dataset.n === 'any' ? 'any' : +c.dataset.n; draw();
    });
    app.querySelectorAll('[data-drop]').forEach(b => b.onclick = () => {
      // removing a club drops the ones after it too: those were filtered
      // against it and may no longer share a player with what remains
      chosen = chosen.slice(0, +b.dataset.drop); draw();
    });

    // One typeahead, offering only clubs that share a player with the picks so
    // far, so a board can never come out empty. There is no cap on how many
    // you add - the filter runs out before the data does.
    const inp = app.querySelector('.clubslot');
    if (inp) {
      const box = document.getElementById('clubsugg');
      inp.oninput = () => {
        const t = inp.value.trim().toLowerCase();
        const hits = t ? more.filter(c => c.label.toLowerCase().includes(t)).slice(0, 7) : [];
        if (!hits.length) { box.hidden = true; box.innerHTML = ''; return; }
        box.hidden = false;
        box.innerHTML = hits.map(c =>
          `<button class="sg" data-k="${esc(c.key)}"><span class="n">${esc(c.label)}</span></button>`).join('');
        box.querySelectorAll('.sg').forEach(x => x.onclick = () => { chosen.push(x.dataset.k); draw(); });
      };
      inp.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        const f = box.querySelector('.sg'); if (f) f.click();
      };
      if (picked.length) inp.focus();
    }

    document.getElementById('go').onclick = () => {
      let board;
      if (mode === 'random') {
        board = PFB.generate(DB, mulberry32((Math.random() * 2 ** 32) >>> 0), n);
        if (!board) return alert('No playable board for that many clubs — try again.');
      } else {
        const sides = picked.map(k => clubs.find(c => c.key === k));
        board = PFB.build(DB, sides);
        if (board.count < 1) return playPFBEmpty(sides);
      }
      PB = PFB.createGame(board);
      playPFB();
    };
  };
  draw();
}

function playPFBEmpty(sides) {
  app.innerHTML = '';
  app.append(el(`<div>
    <div class="bar"><button class="back" id="back">‹ Back</button></div>
    <div class="vsbig">${sides.map(s=>`<span>${esc(s.label)}</span>`).join('<i>×</i>')}</div>
    <div class="fb"><div class="h no">No shared players</div>
      <div class="d">Nobody in our data turned out for two of these. Pick a different set.</div></div>
    <button class="btn" id="again">Choose again</button></div>`));
  document.getElementById('back').onclick = home;
  document.getElementById('again').onclick = setupPFB;
}

// Appearances for each side, so the reveal actually teaches you something
// rather than just listing names you did not get.
function slotRow(id, cls) {
  const p = DB.byId.get(id), b = PB.board;
  // On a two-club board the heading already names the sides in order, so bare
  // numbers read fine and keep the player's name on one line. With three or
  // more, label them - the order is no longer obvious at a glance.
  // Always show every side, even where we hold no figure (Beardsley made one
  // appearance for Manchester United and was dropping off the row entirely).
  const bare = b.sides.length === 2;
  const bits = b.sides.map(s => {
    const f = PFB.figureFor(DB, p, s) || '\u2013';
    return bare ? f : `${shortClub(s.label)} ${f}`;
  });
  return `<div class="slot ${cls}"><span>${esc(p.name)}</span>` +
         (bits.length ? `<span class="fig">${esc(bits.join(' \u00b7 '))}</span>` : '') + `</div>`;
}

function playPFB(msg = null, tone = '') {
  const b = PB.board, done = PB.finished;
  const found = b.answerIds.filter(id => PB.found.has(id));
  const missing = b.answerIds.filter(id => !PB.found.has(id));
  const cleared = PB.found.size === b.count;
  const show = PB.countShown || done;

  app.innerHTML = '';
  app.append(el(`<div>
    <div class="bar"><button class="back" id="back">‹ Back</button>
      <div class="prog"><i style="width:${show ? (PB.found.size/b.count)*100 : 0}%"></i></div>
      <span class="lives">${'●'.repeat(Math.max(0,PB.lives))}${'○'.repeat(PFB.LIVES-Math.max(0,PB.lives))}</span></div>
    <div class="vsbig">${b.sides.map(s=>`<span>${esc(s.label)}</span>`).join('<i>×</i>')}</div>
    <div class="tag" style="margin-bottom:18px">Played for <b>all ${b.sides.length}</b> ·
      ${show ? `${b.count} to find` : '? to find'} · ${PB.found.size} found</div>
    <div class="slots">
      ${found.map(id => slotRow(id, 'on')).join('')}
      ${show ? missing.map(id => done ? slotRow(id, 'miss') : `<div class="slot"></div>`).join('') : ''}
    </div>
    ${done ? `
      <div class="fb"><div class="h ${cleared?'ok':'no'}">
        ${cleared?'Board cleared!':PB.gaveUp?'Here they are':'Out of lives'}</div>
        <div class="d">${PB.found.size} of ${b.count} found${PB.wrong.length?' · missed with '+esc(PB.wrong.join(', ')):''}</div></div>
      <button class="btn" id="again">New board</button>
      <button class="btn ghost" id="home2">Home</button>`
    : `
      <div class="entry"><input id="guess" placeholder="Name a player" autocomplete="off"
        autocapitalize="words" autocorrect="off" spellcheck="false"
        ><button class="btn" id="submit">Add</button></div>
      <div class="sugg" id="sugg" hidden></div>
      ${msg?`<div class="fb"><div class="h ${tone}">${esc(msg)}</div></div>`:''}
      ${PB.countShown?'':`<button class="btn ghost" id="reveal">Clue: how many are there?</button>`}
      <button class="btn ghost" id="giveup">Give up</button>`}
  </div>`));

  document.getElementById('back').onclick = home;
  const ag=document.getElementById('again'); if(ag) ag.onclick=setupPFB;
  const h2=document.getElementById('home2'); if(h2) h2.onclick=home;
  const rv=document.getElementById('reveal');
  if(rv) rv.onclick=()=>{ PB.countShown=true; playPFB(msg,tone); };
  const gu=document.getElementById('giveup');
  if(gu) gu.onclick=()=>{ PB.gaveUp=true; PB.finished=true; playPFB(); };

  const inp=document.getElementById('guess');
  if(!inp) return;
  const sub=document.getElementById('submit'), box=document.getElementById('sugg');
  let list=[], hi=-1;
  const paint=()=>{
    if(!list.length){box.hidden=true;box.innerHTML='';return;}
    box.hidden=false;
    box.innerHTML=list.map((p,i)=>`
      <button class="sg ${i===hi?'on':''}" data-i="${i}">
        <span class="n">${esc(p.name)}</span>
        <span class="m">${esc([p.nationality,p.position].filter(Boolean).join(' · '))}</span>
      </button>`).join('');
    box.querySelectorAll('.sg').forEach(x=>x.onclick=()=>{
      inp.value=list[x.dataset.i].name; list=[];hi=-1;paint();inp.focus();
    });
  };
  const go=()=>{
    const v=inp.value.trim(); if(!v) return;
    const r=PFB.guess(DB,NAMES,PB,v);
    PFB.apply(PB,r);
    playPFB(PFB.explain(r), r.status==='hit'?'ok':r.status==='already'?'':'no');
  };
  inp.oninput=()=>{list=suggest(NAMES,inp.value,6);hi=-1;paint();};
  inp.onkeydown=(e)=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      if(!list.length)return; e.preventDefault();
      hi=e.key==='ArrowDown'?(hi+1)%list.length:(hi-1+list.length)%list.length; paint();
    } else if(e.key==='Enter'){
      if(hi>=0&&list[hi]){inp.value=list[hi].name;list=[];hi=-1;paint();return;}
      go();
    } else if(e.key==='Escape'){list=[];hi=-1;paint();}
  };
  sub.onclick=go;
  inp.focus();
}

/* ---------------- question modes ---------------- */
function start(mode) {
  enterScreen();
  const daily = mode === 'daily';
  const rnd = mulberry32(daily ? seedFrom('daily-' + today()) : (Math.random() * 2 ** 32) >>> 0);
  const keys = daily ? Object.keys(MODES) : [mode];
  const qs = buildRound(DB, rnd, keys, 10);
  if (!qs.length) { app.innerHTML = '<div class="loading">Could not build a round.</div>'; return; }
  S = { qs, i: 0, score: 0, streak: 0, best: 0, daily, revealed: 1, answered: false };
  render();
}

function render() {
  const q = S.qs[S.i];
  const head = `<div class="bar">
      <button class="back" id="back">‹ Back</button>
      <div class="prog"><i style="width:${(S.i / S.qs.length) * 100}%"></i></div>
      ${S.streak > 1 ? `<span class="streak">🔥${S.streak}</span>` : ''}
      <span class="score">${S.score}</span></div>`;
  let body = `<div class="q">${esc(q.prompt)}</div>`;
  if (q.scope) body += `<div class="scope">${esc(q.scope)}</div>`;
  if (q.mode === 'career-path') {
    body += `<ul class="path">${q.clubs.map((c, i) => `
      <li>${i ? '<span class="ar">↓</span>' : ''}<span>${esc(c.name)}</span>
      <span class="yr">${c.from || ''}${c.to && c.to !== c.from ? '–' + c.to : ''}</span></li>`).join('')}</ul>`;
  }
  if (q.mode === 'who-am-i') {
    body += `<ul class="clues">${q.clues.slice(0, S.revealed).map(c => `<li>${esc(c)}</li>`).join('')}</ul>`;
    if (!S.answered && S.revealed < q.clues.length)
      body += `<button class="btn ghost" id="clue">Another clue (−1 point)</button>`;
  }
  if (q.mode === 'higher-lower') {
    body += `<div class="hl">
      <button class="opt" data-id="${q.options[0].id}">${esc(q.options[0].label)}
        <span class="sub">${esc(q.options[0].sub)} · ${esc(q.options[0].clubs)}</span></button>
      <div class="vs">OR</div>
      <button class="opt" data-id="${q.options[1].id}">${esc(q.options[1].label)}
        <span class="sub">${esc(q.options[1].sub)} · ${esc(q.options[1].clubs)}</span></button></div>`;
  } else {
    body += `<div class="opts">${q.options.map(o =>
      `<button class="opt" data-id="${o.id}">${esc(o.label)}</button>`).join('')}</div>`;
  }
  app.innerHTML = '';
  app.append(el(`<div>${head}${body}</div>`));
  document.getElementById('back').onclick = home;
  const clue = document.getElementById('clue');
  if (clue) clue.onclick = () => { S.revealed++; render(); };
  app.querySelectorAll('.opt').forEach(b => b.onclick = () => answer(b.dataset.id));
}

function answer(id) {
  if (S.answered) return;
  S.answered = true;
  const q = S.qs[S.i];
  const ok = id === q.answerId;
  const pts = q.mode === 'who-am-i' ? (ok ? Math.max(1, q.clues.length - S.revealed + 1) : 0) : ok ? 3 : 0;
  if (ok) { S.score += pts; S.streak++; S.best = Math.max(S.best, S.streak); } else S.streak = 0;
  app.querySelectorAll('.opt').forEach(b => {
    const isAns = b.dataset.id === q.answerId;
    b.classList.add(isAns ? 'right' : b.dataset.id === id ? 'wrong' : 'dim');
    if (q.mode === 'higher-lower') {
      const o = q.options.find(x => x.id === b.dataset.id);
      b.insertAdjacentHTML('afterbegin', `<span class="val">${o.value}</span>`);
    }
    b.onclick = null;
  });
  app.append(el(`<div>
    <div class="fb"><div class="h ${ok ? 'ok' : 'no'}">${ok ? `Correct  +${pts}` : 'Not quite'}</div>
    <div class="d">${esc(q.fact)}</div></div>
    <button class="btn" id="next">${S.i + 1 >= S.qs.length ? 'See result' : 'Next'}</button></div>`));
  document.getElementById('next').onclick = () => {
    if (S.i + 1 >= S.qs.length) return results();
    S.i++; S.revealed = 1; S.answered = false; render();
  };
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function results() {
  if (S.daily) store.markToday();
  if (S.score > store.best) store.best = S.score;
  const max = S.qs.length * 3;
  app.innerHTML = '';
  app.append(el(`<div>
    <div class="big">${S.score}</div><div class="big-sub">out of ${max}</div>
    <div class="rows">
      <div class="row"><span class="k">Best streak</span><span>${S.best}</span></div>
      <div class="row"><span class="k">Questions</span><span>${S.qs.length}</span></div>
      <div class="row"><span class="k">Personal best</span><span>${store.best}</span></div>
    </div>
    <button class="btn" id="again">Play again</button>
    <button class="btn ghost" id="home">Home</button></div>`));
  document.getElementById('again').onclick = () => start(S.daily ? 'daily' : S.qs[0].mode);
  document.getElementById('home').onclick = home;
}

// Hold the opening for its full sweep, but never longer: on a warm cache the
// data is ready in milliseconds and waiting on an animation would just be a
// delay pretending to be polish.
const SPLASH_MS = 1150;
const started = Date.now();
const dropSplash = async () => {
  const el = document.getElementById('splash');
  if (!el) return;
  const wait = Math.max(0, SPLASH_MS - (Date.now() - started));
  await new Promise(r => setTimeout(r, wait));
  el.classList.add('gone');
  setTimeout(() => el.remove(), 600);
};

(async function () {
  try {
    DB = await loadData();
    NAMES = buildNameIndex(DB.players);
    home();
    await dropSplash();
  } catch (e) {
    dropSplash();
    app.innerHTML = `<div class="loading">Could not load data.<br><small>${esc(e.message)}</small></div>`;
  }
  // Background sync: costs nothing when offline, and a new dataset is picked
  // up on the next launch rather than yanked out from under a round in play.
  checkForUpdate().then(v => {
    if (!v) return;
    const b = document.querySelector('.badge');
    if (b) { b.classList.add('on'); b.innerHTML = '<i class="dot"></i>New football data ready — restart to apply'; }
  });
  if ('serviceWorker' in navigator) {
    // A new worker taking control means the shell changed underneath us;
    // reload once so the page is running the code it just fetched.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return; reloading = true; location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.update().catch(() => {});
      navigator.serviceWorker.ready.then(() => {
        const b = document.querySelector('.badge');
        if (b) { b.classList.add('on'); b.innerHTML = '<i class="dot"></i>Offline ready'; }
      });
    }).catch(() => {});
  }
})();
