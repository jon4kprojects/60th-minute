import { loadData } from './data.js';
import { MODES, buildRound } from './engine/index.js';
import { mulberry32, seedFrom } from './rng.js';
import { buildNameIndex, suggest } from './names.js';
import * as F501 from './engine/football501.js';
import * as PFB from './engine/playedForBoth.js';

const app = document.getElementById('app');
const el = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const shortClub = (n) => n.replace(/\s+(F\.?C\.?|A\.?F\.?C\.?|S\.?C\.?|C\.?F\.?)$/i,'')
  .replace(/^(F\.?C\.?|A\.?F\.?C\.?|S\.?C\.?|C\.?F\.?)\s+/i,'').replace(/\s+Club de Fútbol$/i,'').trim();

const store = {
  get best() { try { return +localStorage.getItem('best') || 0; } catch { return 0; } },
  set best(v) { try { localStorage.setItem('best', v); } catch {} },
  doneToday() { try { return localStorage.getItem('daily') === today(); } catch { return false; } },
  markToday() { try { localStorage.setItem('daily', today()); } catch {} },
};

let DB = null, NAMES = null, S = null, G = null;

/* ---------------- home ---------------- */
function home() {
  const offline = navigator.serviceWorker?.controller;
  app.innerHTML = '';
  app.append(el(`<div>
    <img class="logo" src="./brand/logo-lockup.svg" width="250" alt="60th Minute">
    <div class="tag">${DB.players.length.toLocaleString()} players · 1940s to today</div>
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
    ${store.best ? `<div class="tag" style="margin-top:10px">Best score ${store.best}</div>` : ''}
  </div>`));
  app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    const g = b.dataset.go;
    if (g === 'f501') return setup501();
    if (g === 'pfb') return startPFB();
    start(g);
  });
}

/* ---------------- Football 501 ---------------- */
function setup501() {
  const clubs = F501.clubsWithDepth(DB, 15);
  let metric = 'goals', n = 2;
  const draw = () => {
    app.innerHTML = '';
    app.append(el(`<div>
      <div class="bar"><button class="back" id="back">‹ Back</button></div>
      <div class="kicker">Football 501</div>
      <h1 style="font-size:30px">Set up the <em>oche</em></h1>
      <div class="tag">Everyone starts on 501. Name players who turned out for the club —
        their number comes off your score. Over 180 and you get nothing.</div>
      <label>Club</label>
      <select id="club">${clubs.map(c =>
        `<option value="${esc(c.name)}">${esc(shortClub(c.name))} — ${c.n} players</option>`).join('')}</select>
      <label>Score by</label>
      <div class="chips" id="metric">${Object.entries(F501.METRICS).map(([k, m]) =>
        `<button class="chip ${k === metric ? 'on' : ''}" data-m="${k}">${m.label}</button>`).join('')}</div>
      <label>Players</label>
      <div class="chips" id="np">${[2,3,4].map(i =>
        `<button class="chip ${i === n ? 'on' : ''}" data-n="${i}">${i}</button>`).join('')}</div>
      <div id="names">${Array.from({length: n}, (_, i) =>
        `<input class="nm" placeholder="Player ${i+1}" value="" style="margin-top:8px">`).join('')}</div>
      <button class="btn" id="go">Start</button></div>`));
    document.getElementById('back').onclick = home;
    app.querySelectorAll('#metric .chip').forEach(c => c.onclick = () => { metric = c.dataset.m; draw(); });
    app.querySelectorAll('#np .chip').forEach(c => c.onclick = () => { n = +c.dataset.n; draw(); });
    document.getElementById('go').onclick = () => {
      const names = [...app.querySelectorAll('.nm')].map((i, k) => i.value.trim() || `Player ${k+1}`);
      G = F501.createGame({ club: document.getElementById('club').value, metric, names });
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
      <span>${esc(shortClub(G.club))} · ${m.label}</span></div>
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
      <div class="turnline"><b>${esc(G.players[G.turn].name)}</b> to throw — name a ${esc(shortClub(G.club))} player</div>
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
      play501(F501.explain(r, F501.METRICS[G.metric].label), tone);
    };
    sub.onclick = go;
    inp.focus();
  }
}

/* ---------------- Played for Both ---------------- */
let PB = null;

function startPFB() {
  const board = PFB.generate(DB, mulberry32((Math.random() * 2 ** 32) >>> 0));
  if (!board) { app.innerHTML = '<div class="loading">Could not build a board.</div>'; return; }
  PB = PFB.createGame(board);
  playPFB();
}

function playPFB(msg = null, tone = '') {
  const b = PB.board, done = PB.finished;
  const found = b.answerIds.filter(id => PB.found.has(id));
  const missing = b.answerIds.filter(id => !PB.found.has(id));
  const cleared = PB.found.size === b.count;

  app.innerHTML = '';
  app.append(el(`<div>
    <div class="bar"><button class="back" id="back">‹ Back</button>
      <div class="prog"><i style="width:${(PB.found.size / b.count) * 100}%"></i></div>
      <span class="lives">${'●'.repeat(Math.max(0, PB.lives))}${'○'.repeat(PFB.LIVES - Math.max(0, PB.lives))}</span></div>
    <div class="vsbig"><span>${esc(b.left.label)}</span><i>×</i><span>${esc(b.right.label)}</span></div>
    <div class="tag" style="margin-bottom:18px">${b.count} players · ${PB.found.size} found</div>
    <div class="slots">
      ${found.map(id => `<div class="slot on">${esc(DB.byId.get(id).name)}</div>`).join('')}
      ${missing.map(id => done
        ? `<div class="slot miss">${esc(DB.byId.get(id).name)}</div>`
        : `<div class="slot"></div>`).join('')}
    </div>
    ${done ? `
      <div class="fb"><div class="h ${cleared ? 'ok' : 'no'}">
        ${cleared ? 'Board cleared!' : PB.gaveUp ? 'Here they are' : 'Out of lives'}</div>
        <div class="d">${PB.found.size} of ${b.count} found${PB.wrong.length ? ' · missed with ' + esc(PB.wrong.join(', ')) : ''}</div></div>
      <button class="btn" id="again">New board</button>
      <button class="btn ghost" id="home2">Home</button>`
    : `
      <div class="entry"><input id="guess" placeholder="Name a player" autocomplete="off"
        autocapitalize="words" autocorrect="off" spellcheck="false"
        ><button class="btn" id="submit">Add</button></div>
      <div class="sugg" id="sugg" hidden></div>
      ${msg ? `<div class="fb"><div class="h ${tone}">${esc(msg)}</div></div>` : ''}
      <button class="btn ghost" id="giveup">Give up</button>`}
  </div>`));

  document.getElementById('back').onclick = home;
  const ag = document.getElementById('again'); if (ag) ag.onclick = startPFB;
  const h2 = document.getElementById('home2'); if (h2) h2.onclick = home;
  const gu = document.getElementById('giveup');
  if (gu) gu.onclick = () => { PB.gaveUp = true; PB.finished = true; playPFB(); };

  const inp = document.getElementById('guess');
  if (!inp) return;
  const sub = document.getElementById('submit'), box = document.getElementById('sugg');
  let list = [], hi = -1;
  const paint = () => {
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = list.map((p, i) => `
      <button class="sg ${i === hi ? 'on' : ''}" data-i="${i}">
        <span class="n">${esc(p.name)}</span>
        <span class="m">${esc([p.nationality, p.position].filter(Boolean).join(' · '))}</span>
      </button>`).join('');
    box.querySelectorAll('.sg').forEach(x => x.onclick = () => {
      inp.value = list[x.dataset.i].name; list = []; hi = -1; paint(); inp.focus();
    });
  };
  const go = () => {
    const v = inp.value.trim(); if (!v) return;
    const r = PFB.guess(DB, NAMES, PB, v);
    PFB.apply(PB, r);
    playPFB(PFB.explain(r, PB.board), r.status === 'hit' ? 'ok' : r.status === 'already' ? '' : 'no');
  };
  inp.oninput = () => { list = suggest(NAMES, inp.value, 6); hi = -1; paint(); };
  inp.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!list.length) return; e.preventDefault();
      hi = e.key === 'ArrowDown' ? (hi + 1) % list.length : (hi - 1 + list.length) % list.length;
      paint();
    } else if (e.key === 'Enter') {
      if (hi >= 0 && list[hi]) { inp.value = list[hi].name; list = []; hi = -1; paint(); return; }
      go();
    } else if (e.key === 'Escape') { list = []; hi = -1; paint(); }
  };
  sub.onclick = go;
  inp.focus();
}

/* ---------------- question modes ---------------- */
function start(mode) {
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

(async function () {
  try {
    DB = await loadData();
    NAMES = buildNameIndex(DB.players);
    home();
  } catch (e) {
    app.innerHTML = `<div class="loading">Could not load data.<br><small>${esc(e.message)}</small></div>`;
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(() => {
      navigator.serviceWorker.ready.then(() => {
        const b = document.querySelector('.badge');
        if (b) { b.classList.add('on'); b.innerHTML = '<i class="dot"></i>Offline ready'; }
      });
    }).catch(() => {});
  }
})();
