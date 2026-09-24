import { loadData } from './data.js';
import { MODES, buildRound } from './engine/index.js';
import { mulberry32, seedFrom } from './rng.js';

const app = document.getElementById('app');
const el = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);

const store = {
  get best() { try { return +localStorage.getItem('best') || 0; } catch { return 0; } },
  set best(v) { try { localStorage.setItem('best', v); } catch {} },
  doneToday() { try { return localStorage.getItem('daily') === today(); } catch { return false; } },
  markToday() { try { localStorage.setItem('daily', today()); } catch {} },
};

let DB = null, S = null;

function home() {
  const offline = navigator.serviceWorker?.controller;
  app.innerHTML = '';
  app.append(el(`<div>
    <h1>Footy</h1>
    <div class="tag">${DB.players.length.toLocaleString()} players · 1940s to today</div>
    ${Object.entries(MODES).map(([k, m]) => `
      <button class="card" data-mode="${k}"><div class="t">${m.title}</div><div class="b">${m.blurb}</div></button>`).join('')}
    <button class="card" data-mode="daily" style="border-color:var(--accent-dim)">
      <div class="t">Daily Challenge ${store.doneToday() ? '✓' : ''}</div>
      <div class="b">10 questions · same for everyone today</div></button>
    <div class="spacer"></div>
    <div class="badge ${offline ? 'on' : ''}"><i class="dot"></i>${offline ? 'Offline ready' : 'Caching…'}</div>
    ${store.best ? `<div class="tag" style="margin-top:10px">Best score ${store.best}</div>` : ''}
  </div>`));
  app.querySelectorAll('[data-mode]').forEach(b =>
    b.onclick = () => start(b.dataset.mode));
}

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
  const pts = q.mode === 'who-am-i' ? Math.max(1, q.clues.length - S.revealed + 1) : ok ? 3 : 0;
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
    home();
  } catch (e) {
    app.innerHTML = `<div class="loading">Could not load data.<br><small>${esc(e.message)}</small></div>`;
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(r => {
      r.addEventListener('updatefound', () => location.reload());
      if (navigator.serviceWorker.controller) return;
      navigator.serviceWorker.ready.then(() => {
        const b = document.querySelector('.badge');
        if (b) { b.classList.add('on'); b.innerHTML = '<i class="dot"></i>Offline ready'; }
      });
    }).catch(() => {});
  }
})();
