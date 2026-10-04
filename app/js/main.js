import { loadData, checkForUpdate, filterDB, teamColour, loadWorld } from './data.js';
import { MODES, buildRound } from './engine/index.js';
import { mulberry32, seedFrom } from './rng.js';
import { buildNameIndex, suggest, lookup } from './names.js';
import * as F501 from './engine/football501.js';
import * as PFB from './engine/playedForBoth.js';
import * as CHN from './engine/chain.js';
import * as GRID from './engine/grid.js';
import * as CC from './engine/countryConundrum.js';

const BUILD = 'b78.e673a3b';
const app = document.getElementById('app');

// Every screen re-renders by rebuilding its markup, which is fine on arrival
// and wrong on a chip tap: the entrance animation replays, the page jumps to
// the top and focus is lost, so a toggle reads as a full reload. Entrance
// motion belongs to arriving somewhere, not to updating what is already there.
let currentScreen = null;
function beginPaint(key) {
  const same = key === currentScreen;
  currentScreen = key;
  app.classList.toggle('noanim', same);
  if (!same) return;
  const y = window.scrollY;
  const a = document.activeElement;
  const id = a && a.id ? a.id : null;
  const caret = id && a.selectionStart != null ? a.selectionStart : null;
  requestAnimationFrame(() => {            // after the rebuild has happened
    window.scrollTo(0, y);
    if (!id) return;
    const f = document.getElementById(id);
    if (!f) return;
    f.focus({ preventScroll: true });
    if (caret != null && f.setSelectionRange) f.setSelectionRange(caret, caret);
  });
}
const el = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
/**
 * A three-letter code for a club, so every row can label its own numbers
 * instead of relying on a legend the reader has to hold in their head.
 * Made unique within a board, since two clubs can reduce to the same letters.
 */
// The derived code is right more often than not, but a football audience knows
// Spurs as TOT and Wolves as WOL, not THO and WWA. Known codes win.
const KNOWN_ABBR = {
  'Tottenham Hotspur': 'TOT', 'Aston Villa': 'AVL', 'Sheffield Wednesday': 'SHW',
  'Wolverhampton Wanderers': 'WOL', 'Derby County': 'DER', 'Newcastle United': 'NEW',
  'Leeds United': 'LEE', 'Leicester City': 'LEI', 'Sunderland': 'SUN',
  'Crystal Palace': 'CRY', 'Bayer 04 Leverkusen': 'LEV', 'Real Madrid': 'RMA',
  'Barcelona': 'BAR', 'Atlético Madrid': 'ATM', 'Bayern Munich': 'BAY',
  'Borussia Dortmund': 'BVB', 'Paris Saint-Germain': 'PSG', 'Inter Milan': 'INT',
  'AC Milan': 'MIL', 'Juventus': 'JUV', 'Ajax': 'AJA', 'PSV Eindhoven': 'PSV',
  'Olympique de Marseille': 'OM', 'Olympique Lyonnais': 'OL', 'Sporting CP': 'SCP',
  'Benfica': 'SLB', 'Porto': 'POR', 'Schalke 04': 'S04', 'VfB Stuttgart': 'VFB',
  'Rangers': 'RAN', 'Celtic': 'CEL', 'West Bromwich Albion': 'WBA',
  'Queens Park Rangers': 'QPR', 'Blackburn Rovers': 'BLA', 'Bolton Wanderers': 'BOL',
};

function abbrClub(name) {
  const k = shortClub(name);
  if (KNOWN_ABBR[k]) return KNOWN_ABBR[k];
  const words = shortClub(name)
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !/^\d+$/.test(w));   // drop "04", "1913", initials
  if (!words.length) return shortClub(name).slice(0, 3).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  if (words.length === 2) return (words[0][0] + words[1].slice(0, 2)).toUpperCase();
  return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
}
function abbrSet(names) {
  const seen = new Map();
  return names.map(n => {
    let a = abbrClub(n), i = 1;
    while ([...seen.values()].includes(a)) {           // keep codes distinct
      a = abbrClub(n).slice(0, 2) + shortClub(n).replace(/\s/g, '')[2 + i].toUpperCase();
      if (++i > 6) { a = abbrClub(n) + i; break; }
    }
    seen.set(n, a);
    return a;
  });
}

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
  // Era is per game, not per app. Picking 2010 for a round of Higher or Lower
  // should not quietly narrow the Chain you play next, and each game remembers
  // what it was last played at.
  eraFor(key) { try { return +localStorage.getItem('era:' + key) || 0; } catch { return 0; } },
  setEra(key, v) { try { localStorage.setItem('era:' + key, v || 0); } catch {} },
  get topFive() { try { return localStorage.getItem('t5') === '1'; } catch { return false; } },
  set topFive(v) { try { localStorage.setItem('t5', v ? '1' : ''); } catch {} },
};

let DB = null, NAMES = null, S = null, G = null;
let VIEW = null, VNAMES = null, VCLUBS = null, CH = null;

// Filters are applied to the data BEFORE a round starts, not inside each
// generator: a generator that forgot one would quietly serve players the
// filter was meant to exclude.
function refreshView(key = null) {
  VIEW = filterDB(DB, { since: (key && store.eraFor(key)) || null, topFive: store.topFive });
  VNAMES = buildNameIndex(VIEW.players);
  VCLUBS = CHN.buildClubIndex(VIEW);
}

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
  beginPaint('home');
  app.innerHTML = '';
  app.append(el(`<div>
    <img class="logo" src="./brand/logo-lockup.svg" width="250" alt="60th Minute">
    <div class="tag">${DB.players.length.toLocaleString()} players · 1940s to today</div>
    <div class="dataver">Build ${esc(BUILD)} · data ${esc(DB.version)}</div>
    <button class="card hot" data-go="f501">
      <div class="t">Football 501</div><div class="b">Darts, with footballers · 2–4 players</div></button>
    <button class="card hot" data-go="chain">
      <div class="t">The Chain</div><div class="b">Player, team, player, team · 2–4 players</div></button>
    <button class="card hot" data-go="cc">
      <div class="t">Country Conundrum</div><div class="b">Find 30 nations on the map \u00b7 solo</div></button>
    <button class="card hot" data-go="grid">
      <div class="t">The Grid</div><div class="b">Nine squares \u00b7 one player who fits both</div></button>
    <button class="card hot" data-go="pfb">
      <div class="t">Played for Both</div><div class="b">Clear the board · name every shared player</div></button>
    ${Object.entries(MODES).map(([k, m]) => `
      <button class="card" data-go="${k}"><div class="t">${m.title}</div><div class="b">${m.blurb}</div></button>`).join('')}
    <button class="card" data-go="daily">
      <div class="t">Daily Challenge ${store.doneToday() ? '✓' : ''}</div>
      <div class="b">10 questions · same for everyone today</div></button>
    <div class="spacer"></div>
    <div class="badge ${offline ? 'on' : ''}"><i class="dot"></i>${offline ? 'Offline ready' : 'Caching…'}</div>
    ${store.best ? `<div class="tag" style="margin-top:10px">Best round ${store.best} correct</div>` : ''}
    <button class="linkish" id="getit">Get it on another phone</button>
  </div>`));
  document.getElementById('getit').onclick = () => { enterScreen(); landing(); };
  app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    const g = b.dataset.go;
    if (g === 'f501') return setup501();
    if (g === 'pfb') return setupPFB();
    if (g === 'chain') return setupChain();
    if (g === 'grid') return setupGrid();
    if (g === 'cc') return setupCC();
    if (MODES[g]) return setupQuiz(g);
    start(g);
  });
}

const ERAS = [[0, 'Any'], [1990, '1990 or later'], [2000, '2000 or later'], [2010, '2010 or later']];

/**
 * The era control, rendered into a game's own setup rather than the home
 * screen. Whose players a round is drawn from is part of setting that round
 * up, and it reads as a global preference when it sits above every game.
 */
function eraRow(key) {
  const cur = store.eraFor(key);
  return `<label>Career started</label>
    <div class="chips erapick">${ERAS.map(([y, l]) =>
      `<button class="chip ${cur === y ? 'on' : ''}" data-y="${y}">${esc(l)}</button>`).join('')}</div>
    <div class="tag" style="margin:6px 2px 14px">${cur
      ? `Only players whose <b>first season at a club</b> was ${cur} or later \u2014
         ${VIEW.players.length.toLocaleString()} of them. A career that began earlier is out,
         however long it ran.`
      : 'Every player we hold, whenever they started \u2014 back to the 1940s.'}</div>`;
}

function wireEra(key, redraw) {
  app.querySelectorAll('.erapick .chip').forEach(c => c.onclick = () => {
    store.setEra(key, +c.dataset.y);
    refreshView(key);
    redraw();
  });
}

/* ---------------- Landing ---------------- */

// Installing is the whole point of this app - in the desert a browser tab is
// useless. So the door into the app is also where we ask, once, before anyone
// has started playing. Already installed, and this screen never appears.
function landing() {
  atHome = true;
  beginPaint('landing');
  app.innerHTML = '';
  app.append(el(`<div>
    <img class="logo" src="./brand/logo-lockup.svg" width="250" alt="60th Minute">
    <div class="tag">${DB.players.length.toLocaleString()} players \u00b7 1940s to today.
      Put it on your home screen and it works with no signal at all.</div>
    <button class="btn" id="enter">${installed() ? 'Back to the games' : 'Enter'}</button>
    <button class="btn ghost" data-how="ios">Add to iPhone as an app</button>
    <button class="btn ghost" data-how="android">Add to Android as an app</button>
    <div class="dataver foot">Build ${esc(BUILD)} \u00b7 data ${esc(DB.version)}</div>
  </div>`));
  document.getElementById('enter').onclick = home;
  app.querySelectorAll('[data-how]').forEach(b => b.onclick = () => installGuide(b.dataset.how));
}

function installGuide(p) {
  const ios = p === 'ios';
  const steps = ios ? [
    'Open this page in <b>Safari</b>. Only Safari can install it on iPhone.',
    'Tap the <b>Share</b> button \u2014 the square with an arrow out of the top.',
    'Scroll down and tap <b>Add to Home Screen</b>.',
    'Choose <b>Open as Web App</b> if that option appears.',
    'Tap <b>Add</b>.',
  ] : [
    'Open this page in <b>Chrome</b>.',
    'Tap the <b>\u22ee</b> three dots, top right.',
    'Tap <b>Add to Home screen</b>, or <b>Install app</b>.',
    'If prompted, choose <b>Install</b>.',
    'It appears on your home screen or in the app drawer.',
  ];
  enterScreen();
  beginPaint('installGuide');
  app.innerHTML = '';
  app.append(el(`<div>
    <div class="bar"><button class="back" id="back">\u2039 Back</button></div>
    <div class="kicker">${ios ? 'iPhone' : 'Android'}</div>
    <h1 style="font-size:30px">Add it as an <em>app</em></h1>
    <ol class="steps">${steps.map(t => `<li>${t}</li>`).join('')}</ol>
    <div class="tag">It then sits on your home screen with its own icon and no
      address bar, and every game works with no signal at all.</div>
    ${!ios && deferredPrompt ? '<button class="btn" id="doinstall">Install now</button>' : ''}
    <button class="btn ghost" id="enter">Skip, just play</button>
  </div>`));
  document.getElementById('back').onclick = landing;
  document.getElementById('enter').onclick = home;
  const di = document.getElementById('doinstall');
  if (di) di.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    home();
  };
}

/* ---------------- Football 501 ---------------- */
function setup501() {
  enterScreen();
  refreshView('f501');
  // Which clubs have enough depth to score a leg depends on the era, so the
  // list is rebuilt whenever it changes rather than captured once.
  let kind = 'club';
  const clubList = () => (kind === 'country'
      ? F501.teamsWithDepth(VIEW, 25)
      : F501.clubsWithDepth(VIEW, 15)).slice()
    .sort((a, b) => shortClub(a.name).localeCompare(shortClub(b.name)));   // alphabetical
  let clubs = clubList();
  let club = null, metric = 'goals', scope = 'all', n = 2, filter = '';
  let start = 501, hints = 3, turnSeconds = 0, limit = 0;
  // Appearances for a club are caps for a country, and nobody calls them
  // appearances when the shirt is England's.
  const metricLabel = (k) => (kind === 'country' && k === 'apps') ? 'Caps' : F501.METRICS[k].label;

  // Every control redraws the whole panel, so typed names must survive it.
  // Without this, changing the metric or player count silently wiped them.
  const redraw = () => {
    const names = [...app.querySelectorAll('.nm')].map(i => i.value);
    draw();
    [...app.querySelectorAll('.nm')].forEach((i, k) => { if (names[k]) i.value = names[k]; });
  };

  const draw = () => {
    // An international career has no league and cup to tell apart, so the
    // scope control is not shown and the figures are simply caps and goals.
    // Only a cross-checked club has all-competition figures. Everything else is
    // scored on league figures taken from player infoboxes, so that is what the
    // control has to say: Real Madrid showing "All competitions" over numbers
    // that are league-only is the kind of claim a purist checks and we lose.
    const hasAll = kind === 'country' ? true : (club ? F501.hasAllComps(VIEW, club, metric) : true);
    const hasLg  = kind === 'country' ? false
      : (club ? (!hasAll || F501.hasLeagueSplit(VIEW, club)) : false);
    if (!hasAll) scope = 'league';
    else if (!hasLg) scope = 'all';
    const shown = clubs.filter(c => shortClub(c.name).toLowerCase().includes(filter.toLowerCase()));
    beginPaint('setup501');
    app.innerHTML = '';
    app.append(el(`<div>
      <div class="bar"><button class="back" id="back">‹ Back</button></div>
      <div class="kicker">Football 501</div>
      <h1 style="font-size:30px">Set up the <em>oche</em></h1>
      <div class="tag">Everyone starts on ${start}. Name players who turned out for
        ${kind === 'country' ? 'the country' : 'the club'} — their number comes off your
        score. Land on nothing exactly to win; overshoot and you bust, and your score
        goes back where it was.</div>

      ${eraRow('f501')}
      <label>Play with</label>
      <div class="chips" id="kind">
        <button class="chip ${kind === 'club' ? 'on' : ''}" data-k="club">Clubs</button>
        <button class="chip ${kind === 'country' ? 'on' : ''}" data-k="country">Countries</button>
      </div>

      <label>${kind === 'country' ? 'Country' : 'Club'}</label>
      <input id="clubq" placeholder="Type a ${kind === 'country' ? 'country' : 'club'}" value="${esc(filter)}"
        autocomplete="off" autocorrect="off" spellcheck="false">
      <div class="sugg" id="clublist" hidden></div>
      ${club && !filter ? `<div class="chosen">${esc(shortClub(club))}<button class="x" id="clear">change</button></div>` : ''}

      <label>Score by</label>
      <div class="chips" id="metric">${Object.keys(F501.METRICS).map(k =>
        `<button class="chip ${k === metric ? 'on' : ''}" data-m="${k}">${esc(metricLabel(k))}</button>`).join('')}</div>

      ${kind === 'country' ? `
      <div class="scopenote" style="margin-top:12px">
        Caps and international goals for that country only.<br>
        <span>Wikidata (CC0)</span>
      </div>` : `
      <label>Competitions</label>
      <div class="chips" id="scope">
        <button class="chip ${scope === 'all' ? 'on' : ''} ${hasAll ? '' : 'off'}"
          data-s="all" ${hasAll ? '' : 'disabled'}>All competitions</button>
        <button class="chip ${scope === 'league' ? 'on' : ''} ${hasLg ? '' : 'off'}"
          data-s="league" ${hasLg ? '' : 'disabled'}>League only</button>
      </div>
      <div class="scopenote" style="margin-top:12px">
        ${scope === 'league'
          ? 'League appearances and goals only — no cups, no Europe.'
          : 'All competitions — league, cups and Europe.'}<br>
        <span>${scope === 'league' ? 'Wikipedia player infoboxes' : 'Wikipedia club player lists'} (CC BY-SA)</span>
      </div>`}

      <label>Start from</label>
      <div class="chips" id="start">${F501.STARTS.map(v =>
        `<button class="chip ${v === start ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div>

      <label>Hints each</label>
      <div class="chips" id="hints">${F501.HINT_ALLOWANCES.map(v =>
        `<button class="chip ${v === hints ? 'on' : ''}" data-v="${v}">${v || 'None'}</button>`).join('')}</div>

      <label>Throws each</label>
      <div class="chips" id="limit">${F501.THROW_LIMITS.map(v =>
        `<button class="chip ${v === limit ? 'on' : ''}" data-v="${v}">${v || 'Unlimited'}</button>`).join('')}</div>
      <div class="tag" style="margin:6px 2px 14px">${limit
        ? `After ${limit} throws each, whoever is lowest wins. Checking out still ends it there and then.`
        : 'Play until somebody lands on nothing exactly.'}</div>

      <label>Turn clock</label>
      <div class="chips" id="clock">${F501.TURN_TIMES.map(v =>
        `<button class="chip ${v === turnSeconds ? 'on' : ''}" data-v="${v}">${v ? v + 's' : 'Off'}</button>`).join('')}</div>
      <div class="tag" style="margin:6px 2px 14px">${turnSeconds
        ? `Run out of time and the turn passes \u2014 your score stays where it is.`
        : 'No clock. Take as long as you like.'}</div>

      <label>Players</label>
      <div class="chips" id="np">${[1,2,3,4].map(i =>
        `<button class="chip ${i === n ? 'on' : ''}" data-n="${i}">${i === 1 ? 'Solo' : i}</button>`).join('')}</div>
      <div id="names">${n === 1 ? '' : Array.from({length: n}, (_, i) =>
        `<input class="nm" placeholder="Player ${i+1}" style="margin-top:8px">`).join('')}</div>
      <button class="btn" id="go" ${club ? '' : 'disabled'}>${club ? 'Start' : (kind === 'country' ? 'Choose a country' : 'Choose a club')}</button></div>`));

    document.getElementById('back').onclick = home;
    // A club that had depth under one era may not under another, so the choice
    // is cleared rather than left pointing at a club that is no longer offered.
    wireEra('f501', () => { clubs = clubList(); club = null; redraw(); });
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
      // Barcelona of Catalonia and Barcelona of Guayaquil are different clubs
      // with the same short name, and a list offering both unlabelled is a coin
      // toss. Only the ones that actually collide are labelled.
      const dupe = new Set();
      const seen = new Set();
      for (const c of clubs) {
        const k = shortClub(c.name);
        if (seen.has(k)) dupe.add(k); else seen.add(k);
      }
      box.innerHTML = hits.map(c => {
        const label = shortClub(c.name);
        const where = dupe.has(label) && c.country ? ` \u00b7 ${c.country}` : '';
        return `<button class="sg" data-k="${esc(c.name)}">
           <span class="n">${esc(label)}${esc(where)}</span>
           <span class="m">${c.n} players</span></button>`;
      }).join('');
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
    app.querySelectorAll('#kind .chip').forEach(c => c.onclick = () => {
      // Clubs and countries are different lists entirely, so the chosen subject
      // and the typed filter both go with the old one.
      kind = c.dataset.k; clubs = clubList(); club = null; filter = ''; scope = 'all'; redraw();
    });
    app.querySelectorAll('#start .chip').forEach(c => c.onclick = () => { start = +c.dataset.v; redraw(); });
    app.querySelectorAll('#hints .chip').forEach(c => c.onclick = () => { hints = +c.dataset.v; redraw(); });
    app.querySelectorAll('#clock .chip').forEach(c => c.onclick = () => { turnSeconds = +c.dataset.v; redraw(); });
    app.querySelectorAll('#limit .chip').forEach(c => c.onclick = () => { limit = +c.dataset.v; redraw(); });
    document.getElementById('go').onclick = () => {
      // Solo asks for no name, so there is no input to read: the count is the
      // source of truth for how many players there are, not the markup.
      const typed = [...app.querySelectorAll('.nm')].map(i => i.value.trim());
      const names = Array.from({ length: n }, (_, k) => typed[k] || `Player ${k + 1}`);
      G = F501.createGame({ club, kind, metric, scope, names, start, hints, turnSeconds, limit });
      F5QUIT = false; F5LIST = null; F5HINT = null;
      reset501Clock();
      play501();
    };
  };
  draw();
}

let F5DEADLINE = 0, F5CLOCK = null, F5HINT = null, F5QUIT = false, F5LIST = null;

/** A fresh clock for whoever is up, whether the last turn scored or busted. */
function reset501Clock() {
  F5DEADLINE = Date.now() + (G && G.turnSeconds ? G.turnSeconds * 1000 : 0);
}

// One interval, and it stops itself once the bar leaves the DOM, so leaving
// the screen needs no teardown anywhere else.
function run501Clock() {
  clearInterval(F5CLOCK); F5CLOCK = null;
  if (!G || !G.turnSeconds) return;
  const tick = () => {
    const bar = document.getElementById('f5fill'), num = document.getElementById('f5num');
    if (!bar || !num || !G || G.finished) { clearInterval(F5CLOCK); F5CLOCK = null; return; }
    const left = Math.max(0, F5DEADLINE - Date.now());
    num.textContent = Math.ceil(left / 1000);
    bar.style.width = (left / (G.turnSeconds * 1000) * 100) + '%';
    bar.parentElement.classList.toggle('low', left <= 10000);
    if (left <= 0) {
      clearInterval(F5CLOCK); F5CLOCK = null;
      F501.passTurn(G, 'timeout');
      F5HINT = null; F5LIST = null; reset501Clock();
      play501('Out of time \u2014 turn passed', 'no');
    }
  };
  tick();
  F5CLOCK = setInterval(tick, 200);
}

const throws = (p) => `${p.history.length} ${p.history.length === 1 ? 'throw' : 'throws'}`;

function play501(msg = null, tone = '') {
  const intl = G.kind === 'country';
  // Alone there is nobody to take a turn off you, so the leg is scored by how
  // few throws it took rather than by who got there first.
  const solo = G.players.length === 1;
  const m = F501.METRICS[G.metric];
  // "Appearances" is what a club gives you; a country gives you caps.
  const mLabel = intl && G.metric === 'apps' ? 'Caps' : m.label;
  const mInline = intl && G.metric === 'apps' ? 'caps' : m.inline;
  const scoped = intl ? mInline
    : `${mInline} (${G.scope === 'league' ? 'league only' : 'all competitions'})`;
  beginPaint('play501');
  app.innerHTML = '';
  app.append(el(`<div>
    <div class="bar"><button class="back" id="back">‹ Back</button>
      <span>${esc(shortClub(G.club))} · ${esc(mLabel)}${intl ? '' : ' · ' + esc(F501.SCOPES[G.scope||'all'].label)}</span>
      ${G.limit && !G.finished ? `<span class="score">${F501.throwsLeft(G)} left</span>` : ''}</div>
    ${intl ? '<div class="scopeline">For that country only</div>'
           : (DB.statScope ? `<div class="scopeline">${esc(DB.statScope)}</div>` : '')}
    <div class="board">${G.players.map((p, i) => {
      const last = p.history[p.history.length - 1];
      return `<div class="seat ${i === G.turn && !G.finished ? 'active' : ''}">
        <div>${solo ? '' : `<div class="nm">${esc(p.name)}</div>`}
        ${last ? `<div class="last">${esc(last.name || 'no player')} · ${last.score || 0}</div>` : ''}</div>
        <div class="sc">${p.score}</div></div>`; }).join('')}</div>
    ${G.finished ? `
      <div class="fb"><div class="h ${G.abandoned || G.onLimit ? 'no' : 'ok'}">${
        G.abandoned ? 'Round given up'
        : G.onLimit ? (G.drawn ? 'Throws up \u2014 a tie'
                               : esc(G.players[G.winner].name) + ' wins on the count-back')
        : (solo ? 'Checked out!' : esc(G.players[G.winner].name) + ' checks out!')}</div>
      <div class="d">${
        G.abandoned ? (solo
            ? `Stopped on ${G.players[0].score}, after ${throws(G.players[0])}.`
            : `${esc(G.players[G.winner].name)} was closest on ${G.players[G.winner].score}.`)
        : G.onLimit ? (G.drawn
            ? `Level on ${G.players[G.winner].score} after ${G.limit} throws each. Nobody checked out.`
            : `Lowest on ${G.players[G.winner].score} after ${G.limit} throws each. Nobody checked out.`)
        : (solo
            ? `${G.start} down to nothing in ${throws(G.players[0])}.`
            : `Finished on ${G.players[G.winner].score}.`)}</div></div>
      ${(G.abandoned || G.onLimit) ? `<div class="couts">${F501.checkouts(VIEW, G).map(c => `
        <div class="cout"><div class="h"><b>${esc(c.name)}</b> needed ${c.score}</div>
          <div class="d">${c.names.length
            ? esc(c.names.join(' \u00b7 '))
            : 'Nobody left on exactly that number.'}</div></div>`).join('')}</div>` : ''}
      <button class="btn" id="again">Play again</button>
      <button class="btn ghost" id="home2">Home</button>`
    : `
      ${G.turnSeconds ? `<div class="clock"><div class="fill" id="f5fill"></div>
        <span class="num" id="f5num">${G.turnSeconds}</span></div>` : ''}
      <div class="turnline">${solo ? '' : `<b>${esc(G.players[G.turn].name)}</b> to throw — `}name ${/^[aeiou]/i.test(shortClub(G.club)) ? 'an' : 'a'} ${esc(shortClub(G.club))} player</div>
      ${F5HINT ? `<div class="opts">${F5HINT.map(o =>
          `<button class="opt" data-hid="${esc(o.id)}">${esc(o.name)}</button>`).join('')}</div>`
        : `<div class="entry"><input id="guess" placeholder="Player name" autocomplete="off"
             autocapitalize="words" autocorrect="off" spellcheck="false"
             ><button class="btn" id="submit">Score</button></div>
           <div class="sugg" id="sugg" hidden></div>`}
      <div class="row2">
        ${!F5HINT && G.players[G.turn].hints > 0
          ? `<button class="btn ghost" id="hint">Hint (${G.players[G.turn].hints} left)</button>` : ''}
        ${!F5LIST && G.players[G.turn].hints > 0
          ? `<button class="btn ghost" id="plist">Player list</button>` : ''}
        ${solo ? '' : '<button class="btn ghost" id="pass">Pass</button>'}
      </div>
      ${F5LIST ? `
        <div class="plist">
          <div class="ph">${F5LIST.total.toLocaleString()} could not bust you \u00b7 showing
            ${F5LIST.rows.length}, highest first \u00b7 names hidden
            <button class="x" id="plclose">close</button></div>
          ${F5LIST.rows.map(r => `<div class="pr">
            <div class="v">${r.value}</div>
            <div class="m"><div class="t">${esc([r.nationality, r.position].filter(Boolean).join(' \u00b7 ') || 'Unknown')}
              <span class="y">${r.from || '?'}\u2013${r.ongoing ? 'present' : (r.to || '?')}</span></div>
              <div class="cl">${esc(r.clubs.join(' \u203a '))}</div></div></div>`).join('')}
        </div>` : ''}
      <button class="btn ghost" id="quit">${F5QUIT ? 'Tap again to end the round' : 'Give up'}</button>
      ${msg ? `<div class="fb"><div class="h ${tone}">${esc(msg)}</div></div>` : ''}`}
    <ul class="log">${G.players.flatMap(p => p.history.map((h, i) => ({ p, h, i })))
      .sort((a, b) => b.i - a.i).slice(0, 12).map(({ p, h }) =>
        `<li>${solo ? '' : `<span class="who">${esc(p.name)}</span>`}<span>${esc(h.name || '—')}</span>
        <span class="pts ${h.score ? '' : 'zero'}">${h.score || 0}</span></li>`).join('')}</ul>
  </div>`));
  document.getElementById('back').onclick = home;
  const again = document.getElementById('again'); if (again) again.onclick = setup501;
  const h2 = document.getElementById('home2'); if (h2) h2.onclick = home;

  const commit = (r) => {
    F5QUIT = false;
    const t = (r.status === 'ok' || r.status === 'win') ? 'ok' : 'no';
    F501.applyTurn(G, r);
    F5HINT = null; F5LIST = null; reset501Clock();
    play501(F501.explain(r, scoped), t);
  };

  // Two taps. A mis-tap that ended somebody else's leg would be unforgivable
  // in a four-player game, and a dialog on a phone is worse than a second tap.
  const quit = document.getElementById('quit');
  if (quit) quit.onclick = () => {
    if (!F5QUIT) { F5QUIT = true; play501(msg, tone); return; }
    F5QUIT = false; clearInterval(F5CLOCK); F5CLOCK = null;
    F501.giveUp(G);
    play501();
  };

  const pass = document.getElementById('pass');
  if (pass) pass.onclick = () => {
    F5QUIT = false;
    F501.passTurn(G);
    F5HINT = null; F5LIST = null; reset501Clock();
    play501(`${G.players[(G.turn - 1 + G.players.length) % G.players.length].name} passed`, 'no');
  };

  // The list is the other way to spend a hint. It never names anybody, but the
  // top row is the checkout and a career path gives the rest away, so it has to
  // cost the same as being handed four names.
  const plist = document.getElementById('plist');
  if (plist) plist.onclick = () => {
    F5QUIT = false;
    const l = F501.redactedList(VIEW, G);
    if (!l.rows.length) return play501('Nobody left who would not bust you', 'no');
    G.players[G.turn].hints--;
    F5LIST = l;
    play501(msg, tone);
  };
  const plc = document.getElementById('plclose');
  if (plc) plc.onclick = () => { F5LIST = null; play501(msg, tone); };

  const hint = document.getElementById('hint');
  if (hint) hint.onclick = () => {
    F5QUIT = false;
    const opts = F501.hintOptions(VIEW, G, Math.random);
    if (!opts) return;
    G.players[G.turn].hints--;
    F5HINT = opts;
    play501('Four who played for them \u2014 one of them will not bust you', '');
  };
  // A hint is spent, so picking from it scores exactly as typing would.
  app.querySelectorAll('.opt[data-hid]').forEach(b => b.onclick = () => {
    const p = VIEW.byId.get(b.dataset.hid);
    commit(F501.scoreEntry(VIEW, VNAMES, G, p.name));
  });

  run501Clock();
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
      list = suggest(VNAMES, inp.value, 6); hi = -1; paint();
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
      commit(F501.scoreEntry(VIEW, VNAMES, G, v));
    };
    sub.onclick = go;
    inp.focus();
  }
}

/* ---------------- The Chain ---------------- */
function setupChain() {
  enterScreen();
  refreshView('chain');
  let n = 2;
  const draw = () => {
    beginPaint('setupChain');
    app.innerHTML = '';
    app.append(el(`<div>
      <div class="bar"><button class="back" id="back">‹ Back</button></div>
      <div class="kicker">The Chain</div>
      <h1 style="font-size:30px">Keep the <em>chain</em> going</h1>
      <div class="tag">A team is on the table. Name someone who played for it, and
        another team they played for \u2014 that team is next. Clubs and countries both
        count. Nothing twice, 60 seconds a turn, three lives each.</div>
      ${eraRow('chain')}
      <label>Start from</label>
      <div class="chips" id="start">${F501.STARTS.map(v =>
        `<button class="chip ${v === start ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div>

      <label>Hints each</label>
      <div class="chips" id="hints">${F501.HINT_ALLOWANCES.map(v =>
        `<button class="chip ${v === hints ? 'on' : ''}" data-v="${v}">${v || 'None'}</button>`).join('')}</div>

      <label>Throws each</label>
      <div class="chips" id="limit">${F501.THROW_LIMITS.map(v =>
        `<button class="chip ${v === limit ? 'on' : ''}" data-v="${v}">${v || 'Unlimited'}</button>`).join('')}</div>
      <div class="tag" style="margin:6px 2px 14px">${limit
        ? `After ${limit} throws each, whoever is lowest wins. Checking out still ends it there and then.`
        : 'Play until somebody lands on nothing exactly.'}</div>

      <label>Turn clock</label>
      <div class="chips" id="clock">${F501.TURN_TIMES.map(v =>
        `<button class="chip ${v === turnSeconds ? 'on' : ''}" data-v="${v}">${v ? v + 's' : 'Off'}</button>`).join('')}</div>
      <div class="tag" style="margin:6px 2px 14px">${turnSeconds
        ? `Run out of time and the turn passes \u2014 your score stays where it is.`
        : 'No clock. Take as long as you like.'}</div>

      <label>Players</label>
      <div class="chips" id="np">${[2,3,4].map(i =>
        `<button class="chip ${i === n ? 'on' : ''}" data-n="${i}">${i}</button>`).join('')}</div>
      <div id="names">${Array.from({length: n}, (_, i) =>
        `<input class="nm" placeholder="Player ${i+1}" style="margin-top:8px">`).join('')}</div>
      <button class="btn" id="go">Play</button></div>`));
    document.getElementById('back').onclick = home;
    wireEra('chain', draw);
    app.querySelectorAll('#np .chip').forEach(c => c.onclick = () => {
      const keep = [...app.querySelectorAll('.nm')].map(i => i.value);
      n = +c.dataset.n; draw();
      [...app.querySelectorAll('.nm')].forEach((i, k) => { if (keep[k]) i.value = keep[k]; });
    });
    document.getElementById('go').onclick = () => {
      const names = [...app.querySelectorAll('.nm')].map((i, k) => i.value.trim() || `Player ${k+1}`);
      const starter = CHN.pickStarter(VIEW, mulberry32((Math.random() * 2 ** 32) >>> 0));
      if (!starter) return alert('Could not start a chain with these filters.');
      CH = CHN.createGame({ names, starter });
      resetChainClock();
      playChain();
    };
  };
  draw();
}

let CHDEADLINE = 0, CHCLOCK = null;

/** Every turn gets a fresh minute, whether the last one was right or wrong. */
function resetChainClock() {
  CHDEADLINE = Date.now() + CHN.TURN_SECONDS * 1000;
}

/**
 * One interval drives the countdown. It stops itself once the bar leaves the
 * DOM, so navigating away needs no teardown anywhere else.
 */
function runChainClock() {
  clearInterval(CHCLOCK);
  const tick = () => {
    const bar = document.getElementById('clockfill');
    const num = document.getElementById('clocknum');
    if (!bar || !num || !CH || CH.finished) { clearInterval(CHCLOCK); CHCLOCK = null; return; }
    const left = Math.max(0, CHDEADLINE - Date.now());
    const secs = Math.ceil(left / 1000);
    num.textContent = secs;
    bar.style.width = (left / (CHN.TURN_SECONDS * 1000) * 100) + '%';
    bar.parentElement.classList.toggle('low', secs <= 10);
    if (left <= 0) {
      clearInterval(CHCLOCK); CHCLOCK = null;
      CHN.timeout(CH);
      resetChainClock();
      playChain("Out of time", 'no');
    }
  };
  tick();
  CHCLOCK = setInterval(tick, 200);
}

function playChain(msg = null, tone = '') {
  const g = CH;
  const team = CHN.sideLabel(g.team);
  const isCountry = g.team.kind === 'country';
  const size = CHN.membersOf(VIEW, g.team).size;
  beginPaint('playChain');
  app.innerHTML = '';
  app.append(el(`<div>
    <div class="bar"><button class="back" id="back">\u2039 Back</button>
      <span>${g.chain.filter(x => x.kind === 'player').length} in the chain</span></div>

    <div class="board">${g.players.map((p, i) => `
      <div class="seat ${i === g.turn && !g.finished ? 'active' : ''} ${p.out ? 'out' : ''}">
        <div class="nm">${esc(p.name)}</div>
        <div class="sc" style="font-size:15px">${p.out ? 'out'
          : '\u25cf'.repeat(p.lives) + '\u25cb'.repeat(CHN.LIVES - p.lives)}</div></div>`).join('')}</div>

    <div class="onthetable">
      <div class="lbl">On the table</div>
      <div class="who">${esc(team)}</div>
      <div class="sub">${isCountry ? 'Country' : 'Club'} \u00b7 ${size} players we know of</div>
    </div>

    ${g.finished ? `
      <div class="fb"><div class="h ok">${g.winner != null
        ? esc(g.players[g.winner].name) + ' wins' : 'Chain over'}</div>
        <div class="d">${g.chain.filter(x => x.kind === 'player').length} players linked.</div></div>
      <button class="btn" id="again">New chain</button>
      <button class="btn ghost" id="home2">Home</button>`
    : `
      <div class="clock"><div class="fill" id="clockfill"></div>
        <span class="num" id="clocknum">${CHN.TURN_SECONDS}</span></div>
      <div class="turnline"><b>${esc(g.players[g.turn].name)}</b> \u2014 name someone who played
        for ${esc(team)}, and another team they played for</div>
      <input id="playin" placeholder="Player who played for ${esc(team)}" autocomplete="off"
        autocapitalize="words" autocorrect="off" spellcheck="false">
      <div class="sugg" id="playsug" hidden></div>
      <input id="clubin" placeholder="A team they played for" style="margin-top:8px"
        autocomplete="off" autocorrect="off" spellcheck="false">
      <div class="sugg" id="clubsug" hidden></div>
      <button class="btn" id="submit">Link</button>
      ${msg ? `<div class="fb"><div class="h ${tone}">${esc(msg)}</div></div>` : ''}`}

    <ul class="chainlist">${g.chain.slice().reverse().map(x => x.kind === 'team'
      ? `<li class="cl">${esc(x.name)}</li>`
      : `<li class="pl">${esc(x.name)}${x.by ? `<span class="by">${esc(x.by)}</span>` : ''}</li>`).join('')}</ul>
  </div>`));

  document.getElementById('back').onclick = home;
  const ag = document.getElementById('again'); if (ag) ag.onclick = setupChain;
  const h2 = document.getElementById('home2'); if (h2) h2.onclick = home;

  const pi = document.getElementById('playin');
  if (!pi) { clearInterval(CHCLOCK); CHCLOCK = null; return; }
  const ci = document.getElementById('clubin');

  // Suggestions cover every player and every team, never only the valid ones -
  // narrowing them would hand over both halves of the answer.
  const wire = (input, box, source) => {
    input.oninput = () => {
      const t = input.value.trim().toLowerCase();
      const hits = t.length < 2 ? [] : source(t).slice(0, 6);
      if (!hits.length) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      box.innerHTML = hits.map(h =>
        `<button class="sg" data-v="${esc(h)}"><span class="n">${esc(h)}</span></button>`).join('');
      box.querySelectorAll('.sg').forEach(b => b.onclick = () => {
        input.value = b.dataset.v; box.hidden = true; box.innerHTML = '';
        (input === pi ? ci : input).focus();
      });
    };
  };
  wire(pi, document.getElementById('playsug'),
    (t) => suggest(VNAMES, t, 6).map(p => p.name));
  wire(ci, document.getElementById('clubsug'),
    (t) => VCLUBS.labels.filter(c => c.toLowerCase().includes(t)).sort((a, b) => a.length - b.length));

  const go = () => {
    const p = pi.value.trim(), c = ci.value.trim();
    if (!p || !c) return;
    const r = CHN.submit(VIEW, VNAMES, VCLUBS, g, p, c);
    const txt = CHN.explain(r, team);
    CHN.apply(g, r);
    resetChainClock();
    playChain(txt, r.status === 'ok' ? 'ok' : 'no');
  };
  document.getElementById('submit').onclick = go;
  ci.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  pi.focus();
  runChainClock();
}

/* ---------------- Country Conundrum ---------------- */

let CCG = null, CCW = null, CCFLASH = null;

async function setupCC() {
  enterScreen();
  refreshView('cc');
  beginPaint('setupCC');
  app.innerHTML = '<div class="loading">Unrolling the map\u2026</div>';
  try {
    CCW = await loadWorld();
  } catch {
    app.innerHTML = '<div class="loading">Map unavailable offline yet.<br>' +
      '<small>Open once with a signal and it is yours for good.</small></div>';
    return;
  }
  const choices = CC.clubChoices(VIEW, CCW.placed, CC.TARGET);
  const draw = () => {
    beginPaint('setupCC');
    app.innerHTML = '';
    app.append(el(`<div>
      <div class="bar"><button class="back" id="back">\u2039 Back</button></div>
      <div class="kicker">Country Conundrum</div>
      <h1 style="font-size:30px">Name the <em>world</em></h1>
      <div class="tag">A club, and a map. Find ${CC.TARGET} countries whose players have
        turned out for them. Green means somebody did, red means nobody has, and a red
        country stays red. Score is the share of your guesses that land.</div>
      ${eraRow('cc')}
      <div class="tag" style="margin:2px 2px 14px">${choices.length.toLocaleString()} clubs
        have ${CC.TARGET} or more countries to find.</div>
      <button class="btn" id="go">Deal me a club</button></div>`));
    document.getElementById('back').onclick = home;
    wireEra('cc', () => setupCC());
    document.getElementById('go').onclick = () => {
      const picked = CC.pickClub(choices, mulberry32((Math.random() * 2 ** 32) >>> 0));
      if (!picked) return alert('No club has enough countries under that era.');
      CCG = CC.createGame({ club: picked.name,
                            answers: CC.answersFor(VIEW, picked.name, CCW.placed) });
      CCFLASH = null;
      playCC();
    };
  };
  draw();
}

/**
 * The map is drawn once and then only its classes change. Rebuilding 180 paths
 * on every guess made each tap feel like a page load.
 */
function mapSVG() {
  const inert = CCW.inert.map(d => `<path class="cci" d="${d}"/>`).join('');
  const lands = Object.entries(CCW.countries).map(([name, d]) =>
    `<path class="ccp" data-c="${esc(name)}" d="${d}"/>`).join('');
  return `<svg class="worldmap" viewBox="${CCW.viewBox}" preserveAspectRatio="xMidYMid meet"
    role="img" aria-label="World map"><g id="ccz">${inert}${lands}</g></svg>`;
}

// Luxembourg is four pixels wide on a phone at full extent. Drag to move, pinch
// or the buttons to zoom - without this the map is a picture, not a control.
function wireMapZoom() {
  const svg = app.querySelector('.worldmap');
  const g = document.getElementById('ccz');
  if (!svg || !g) return;
  let k = 1, tx = 0, ty = 0;
  const VB = CCW.viewBox.split(' ').map(Number);
  const apply = () => {
    const maxX = VB[2] * (k - 1), maxY = VB[3] * (k - 1);
    tx = Math.min(0, Math.max(-maxX, tx));
    ty = Math.min(0, Math.max(-maxY, ty));
    g.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`);
  };
  const zoomAt = (f, cx, cy) => {
    const nk = Math.min(8, Math.max(1, k * f));
    // keep the point under the fingers where it was
    tx = cx - (cx - tx) * (nk / k);
    ty = cy - (cy - ty) * (nk / k);
    k = nk;
    if (k === 1) { tx = 0; ty = 0; }
    apply();
  };
  const toSvg = (cx, cy) => {
    const r = svg.getBoundingClientRect();
    return [(cx - r.left) / r.width * VB[2], (cy - r.top) / r.height * VB[3]];
  };
  const zi = document.getElementById('zin'), zo = document.getElementById('zout');
  if (zi) zi.onclick = () => zoomAt(1.6, VB[2] / 2, VB[3] / 2);
  if (zo) zo.onclick = () => zoomAt(1 / 1.6, VB[2] / 2, VB[3] / 2);

  // A drag must not land as a tap on whatever country is under the finger.
  let pts = new Map(), moved = 0, startDist = 0, startK = 1;
  svg.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      startDist = Math.hypot(a[0] - b[0], a[1] - b[1]); startK = k;
    }
    moved = 0;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && startDist) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const [cx, cy] = toSvg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      const want = startK * (d / startDist);
      zoomAt(want / k, cx, cy);
      moved = 99;
      return;
    }
    if (pts.size === 1 && k > 1) {
      const r = svg.getBoundingClientRect();
      tx += (e.clientX - prev[0]) / r.width * VB[2];
      ty += (e.clientY - prev[1]) / r.height * VB[3];
      moved += Math.abs(e.clientX - prev[0]) + Math.abs(e.clientY - prev[1]);
      apply();
    }
  });
  const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2) startDist = 0; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [cx, cy] = toSvg(e.clientX, e.clientY);
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, cx, cy);
  }, { passive: false });
  svg.__moved = () => moved > 6;
}

function paintMapState() {
  app.querySelectorAll('.ccp').forEach(el2 => {
    const st = CC.stateOf(CCG, el2.dataset.c);
    el2.classList.toggle('found', st === 'found');
    el2.classList.toggle('wrong', st === 'wrong');
  });
}

function playCC(justDrawn = false) {
  const g = CCG;
  if (!justDrawn) beginPaint('playCC');
  app.innerHTML = '';
  app.append(el(`<div>
    <div class="bar"><button class="back" id="back">\u2039 Back</button>
      <span>${g.found.size} / ${g.target} nations</span>
      <span class="score">${g.guesses} ${g.guesses === 1 ? 'guess' : 'guesses'}</span></div>
    <div class="ccclub">${esc(shortClub(g.club))}</div>

    ${g.finished ? `
      <div class="mapwrap done">${mapSVG()}</div>
      <div class="fb"><div class="h ok">${g.found.size}/${g.target} nations found</div>
        <div class="d">${g.guesses} guesses \u00b7 ${g.wrong.size} wrong \u00b7
          <b>${CC.accuracy(g)}% accuracy</b></div></div>
      <button class="btn" id="again">Another club</button>
      <button class="btn ghost" id="home2">Home</button>`
    : `
      <div class="mapwrap">${mapSVG()}
        <button class="zb" id="zin" aria-label="Zoom in">+</button>
        <button class="zb out" id="zout" aria-label="Zoom out">\u2212</button></div>
      <input id="ccq" placeholder="Tap the map, or type a country" autocomplete="off"
        autocapitalize="words" autocorrect="off" spellcheck="false">
      <div class="sugg" id="ccsug" hidden></div>`}
    <div id="ccflash"></div>
  </div>`));

  document.getElementById('back').onclick = home;
  const ag = document.getElementById('again'); if (ag) ag.onclick = setupCC;
  const h2 = document.getElementById('home2'); if (h2) h2.onclick = home;
  paintMapState();
  if (CCFLASH) showFlash(CCFLASH);

  wireMapZoom();
  const svg = app.querySelector('.worldmap');
  app.querySelectorAll('.ccp').forEach(el2 => el2.onclick = () => {
    if (svg && svg.__moved && svg.__moved()) return;   // that was a pan, not a pick
    submitCC(el2.dataset.c);
  });

  const q = document.getElementById('ccq');
  if (!q) return;
  // Typing is not a shortcut, it is the only way to hit Luxembourg on a phone.
  const box = document.getElementById('ccsug');
  q.oninput = () => {
    const t = q.value.trim().toLowerCase();
    const hits = t.length < 2 ? [] : [...CCW.placed]
      .filter(c => c.toLowerCase().includes(t) && !g.found.has(c) && !g.wrong.has(c))
      .sort((a, b) => a.length - b.length).slice(0, 6);
    if (!hits.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = hits.map(c => `<button class="sg" data-v="${esc(c)}">
      <span class="n">${esc(c)}</span></button>`).join('');
    box.querySelectorAll('.sg').forEach(b => b.onclick = () => {
      q.value = ''; box.hidden = true; box.innerHTML = '';
      submitCC(b.dataset.v);
    });
  };
}

function submitCC(country) {
  const r = CC.guess(CCG, country);
  if (r.status === 'already' || r.status === 'over') return;
  CCFLASH = r;
  // Only the one country changed, so the map is left alone and repainted in
  // place - redrawing it would lose the scroll position and the zoom.
  const el2 = app.querySelector(`.ccp[data-c="${CSS.escape(country)}"]`);
  if (el2) el2.classList.add(r.status === 'correct' ? 'found' : 'wrong');
  const head = app.querySelector('.bar span');
  if (head) head.textContent = `${CCG.found.size} / ${CCG.target} nations`;
  const gs = app.querySelector('.bar .score');
  if (gs) gs.textContent = `${CCG.guesses} ${CCG.guesses === 1 ? 'guess' : 'guesses'}`;
  if (CCG.finished) { CCFLASH = null; playCC(); return; }
  showFlash(r);
}

function showFlash(r) {
  const host = document.getElementById('ccflash');
  if (!host) return;
  host.innerHTML = r.status === 'correct'
    ? `<div class="ccflash ok"><div class="c">${esc(r.country)} \u2713</div>
       <div class="p">${esc(r.players.join(' \u00b7 '))}</div></div>`
    : `<div class="ccflash no"><div class="c">${esc(r.country)} \u2717</div>
       <div class="p">Nobody from there</div></div>`;
}

/* ---------------- The Grid ---------------- */

let GR = null;
let GRSEL = null;      // the square being answered, or null

function setupGrid() {
  enterScreen();
  refreshView('grid');
  const draw = () => {
    beginPaint('setupGrid');
    app.innerHTML = '';
    app.append(el(`<div>
      <div class="bar"><button class="back" id="back">\u2039 Back</button></div>
      <div class="kicker">The Grid</div>
      <h1 style="font-size:30px">Nine <em>squares</em></h1>
      <div class="tag">Every square wants one player who fits the row and the column.
        Nine guesses, nobody twice, and a guess counts whether it lands or not.</div>
      ${eraRow('grid')}
      <button class="btn" id="go">Play</button></div>`));
    document.getElementById('back').onclick = home;
    wireEra('grid', draw);
    document.getElementById('go').onclick = newGrid;
  };
  draw();
}

function newGrid() {
  enterScreen();
  const g = GRID.generate(VIEW, mulberry32((Math.random() * 2 ** 32) >>> 0));
  if (!g) return alert('Could not build a grid from that era. Try widening it.');
  GR = GRID.createGame(g);
  GRSEL = null;
  playGrid();
}

/**
 * A club or country tile wears its colours; a trait ("100+ caps") has none to
 * wear and keeps the card styling, which also stops a board of nine coloured
 * blocks from reading as noise.
 */
function tile(cat, extra) {
  if (cat.kind === 'trait')
    return `<div class="gh trait${extra}">${esc(cat.label)}</div>`;
  const [bg, fg] = teamColour(VIEW, cat.key.slice(2), cat.label, cat.kind === 'country');
  return `<div class="gh${extra}" style="background:${bg};color:${fg}">${esc(cat.label)}</div>`;
}

function gridCell(game, r, c, revealed) {
  const f = game.filled[r][c];
  if (f) return `<button class="gc done" disabled><span>${esc(f.name)}</span></button>`;
  if (revealed) return `<button class="gc miss" disabled><span>${esc(revealed[r][c] || '\u2014')}</span></button>`;
  const on = GRSEL && GRSEL.r === r && GRSEL.c === c;
  return `<button class="gc ${on ? 'on' : ''}" data-r="${r}" data-c="${c}"></button>`;
}

function playGrid(msg = null, tone = '') {
  const g = GR, grid = g.grid;
  const revealed = g.finished && GRID.filledCount(g) < 9 ? GRID.reveal(VIEW, g) : null;
  beginPaint('playGrid');
  app.innerHTML = '';
  app.append(el(`<div>
    <div class="bar"><button class="back" id="back">\u2039 Back</button>
      <span>${GRID.filledCount(g)}/9 filled</span>
      <span class="score">${g.left} left</span></div>

    <div class="gwrap">
      <div class="gh corner"></div>
      ${grid.cols.map(c => tile(c, '')).join('')}
      ${grid.rows.map((r, ri) => `
        ${tile(r, ' side')}
        ${grid.cols.map((_, ci) => gridCell(g, ri, ci, revealed)).join('')}`).join('')}
    </div>

    ${g.finished ? `
      <div class="fb"><div class="h ${GRID.filledCount(g) === 9 ? 'ok' : 'no'}">${
        GRID.filledCount(g) === 9 ? 'Perfect grid' : `${GRID.filledCount(g)} of 9`}</div>
        <div class="d">${GRID.filledCount(g) === 9
          ? 'Every square, and none of them twice.'
          : 'The greyed names are one answer each \u2014 there were others.'}</div></div>
      <button class="btn" id="again">New grid</button>
      <button class="btn ghost" id="home2">Home</button>`
    : GRSEL ? `
      <div class="turnline"><b>${esc(grid.rows[GRSEL.r].label)}</b> and
        <b>${esc(grid.cols[GRSEL.c].label)}</b></div>
      <input id="gin" placeholder="Name a player who fits both" autocomplete="off"
        autocapitalize="words" autocorrect="off" spellcheck="false">
      <div class="sugg" id="gsug" hidden></div>
      <button class="btn" id="gsubmit">Answer</button>
      <button class="btn ghost" id="gcancel">Pick another square</button>`
    : `<div class="turnline">Tap a square. Name one player who fits the row
        <b>and</b> the column \u2014 nobody twice, and every guess counts.</div>
       <button class="btn ghost" id="giveup">Give up</button>`}

    ${msg ? `<div class="fb"><div class="h ${tone}">${esc(msg)}</div></div>` : ''}
  </div>`));

  document.getElementById('back').onclick = home;
  const ag = document.getElementById('again'); if (ag) ag.onclick = newGrid;
  const h2 = document.getElementById('home2'); if (h2) h2.onclick = home;
  const gu = document.getElementById('giveup');
  if (gu) gu.onclick = () => { g.finished = true; GRSEL = null; playGrid(); };

  app.querySelectorAll('.gc[data-r]').forEach(b => b.onclick = () => {
    GRSEL = { r: +b.dataset.r, c: +b.dataset.c };
    playGrid();
  });

  const gi = document.getElementById('gin');
  if (!gi) return;
  document.getElementById('gcancel').onclick = () => { GRSEL = null; playGrid(); };

  const box = document.getElementById('gsug');
  gi.oninput = () => {
    const hits = suggest(VNAMES, gi.value, 6);
    if (!hits.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = hits.map(p => `<button class="sg" data-v="${esc(p.name)}">
      <span class="n">${esc(p.name)}</span>
      <span class="m">${esc([p.nationality, p.position].filter(Boolean).join(' \u00b7 '))}</span></button>`).join('');
    box.querySelectorAll('.sg').forEach(x => x.onclick = () => {
      gi.value = x.dataset.v; box.hidden = true; box.innerHTML = '';
    });
  };
  const go = () => {
    const v = gi.value.trim(); if (!v) return;
    const { r, c } = GRSEL;
    const res = GRID.submit(VIEW, VNAMES, g, r, c, v, lookup);
    GRID.apply(g, res, r, c);
    // A right answer closes the square; a wrong one leaves it open, because the
    // square is still unanswered and a guess has already been paid for it.
    if (res.status === 'ok') GRSEL = null;
    playGrid(GRID.explain(res), res.status === 'ok' ? 'ok' : 'no');
  };
  document.getElementById('gsubmit').onclick = go;
  gi.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  gi.focus();
}

/* ---------------- Played for Both ---------------- */
let PB = null;

function setupPFB() {
  enterScreen();
  refreshView('pfb');
  const clubs = PFB.clubChoices(DB);
  let mode = 'random', n = 2, chosen = [];

  const draw = () => {
    const picked = chosen.filter(Boolean);
    const more = PFB.compatibleClubs(VIEW, picked, clubs);
    const boardSize = picked.length >= 2
      ? PFB.build(VIEW, picked.map(k => clubs.find(c => c.key === k))).count : 0;

    beginPaint('setupPFB');
    app.innerHTML = '';
    app.append(el(`<div>
      <div class="bar"><button class="back" id="back">‹ Back</button></div>
      <div class="kicker">Played for Both</div>
      <h1 style="font-size:30px">Clear the <em>board</em></h1>
      <div class="tag">Name every player who turned out for <b>all</b> of the
        chosen clubs. Three lives.</div>

      ${eraRow('pfb')}
      <label>Leagues</label>
      <div class="chips" id="t5">
        <button class="chip ${store.topFive ? '' : 'on'}" data-t="0">All clubs</button>
        <button class="chip ${store.topFive ? 'on' : ''}" data-t="1">Top 5 only</button>
      </div>
      <div class="tag" style="margin:8px 2px 14px">${store.topFive
        ? 'England, Spain, Italy, Germany and France.'
        : 'Every club we hold, worldwide.'}</div>

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
          <input class="clubslot" placeholder="Search, or pick from the list"
            autocomplete="off" autocorrect="off" spellcheck="false">
          <div class="pickcount">${picked.length
            ? `${more.length} club${more.length === 1 ? '' : 's'} share a player with
               ${picked.map(k => esc(shortClub(k))).join(' and ')} \u2014 that is all of them`
            : `${more.length} clubs to choose from`}</div>
          <div class="sugg open" id="clubsugg"></div>`
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
    wireEra('pfb', () => { chosen = []; draw(); });
    app.querySelectorAll('#t5 .chip').forEach(c => c.onclick = () => {
      store.topFive = c.dataset.t === '1'; refreshView('pfb'); chosen = []; setupPFB();
    });
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
      // The whole eligible list is shown, not just matches for what has been
      // typed. Seven results for "a" gave no way to tell whether those were the
      // only clubs that work, or merely the first seven that matched.
      const listed = [...more].sort((a, b) => a.label.localeCompare(b.label));
      const render = () => {
        const t = inp.value.trim().toLowerCase();
        const hits = t ? listed.filter(c => c.label.toLowerCase().includes(t)) : listed;
        box.innerHTML = hits.length
          ? hits.map(c => `<button class="sg" data-k="${esc(c.key)}">
              <span class="n">${esc(c.label)}</span></button>`).join('')
          : `<div class="sgnone">Nothing matching that shares a player with your picks.</div>`;
        box.querySelectorAll('.sg').forEach(x => x.onclick = () => { chosen.push(x.dataset.k); draw(); });
      };
      render();
      inp.oninput = render;
      inp.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        const f = box.querySelector('.sg'); if (f) f.click();
      };
      if (picked.length) inp.focus();
    }

    document.getElementById('go').onclick = () => {
      let board;
      if (mode === 'random') {
        board = PFB.generate(VIEW, mulberry32((Math.random() * 2 ** 32) >>> 0), n);
        if (!board) return alert('No playable board for that many clubs — try again.');
      } else {
        const sides = picked.map(k => clubs.find(c => c.key === k));
        board = PFB.build(VIEW, sides);
        if (board.count < 1) return playPFBEmpty(sides);
      }
      PB = PFB.createGame(board);
      playPFB();
    };
  };
  draw();
}

function playPFBEmpty(sides) {
  beginPaint('pfb-empty');
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
  const p = VIEW.byId.get(id), b = PB.board;
  // On a two-club board the heading already names the sides in order, so bare
  // numbers read fine and keep the player's name on one line. With three or
  // more, label them - the order is no longer obvious at a glance.
  // Each figure carries its own three-letter club code. A column of bare
  // numbers was unreadable once the board ran past a few rows. Every side
  // always appears, even where we hold no figure (Beardsley made a single
  // Manchester United appearance and was dropping off the row).
  const codes = abbrSet(b.sides.map(x => x.label));
  const bits = b.sides.map((s, i) => `${codes[i]} ${PFB.figureFor(DB, p, s) || '\u2013'}`);
  return `<div class="slot ${cls}"><span>${esc(p.name)}</span>` +
         (bits.length ? `<span class="fig">${esc(bits.join(' \u00b7 '))}</span>` : '') + `</div>`;
}

function playPFB(msg = null, tone = '') {
  const b = PB.board, done = PB.finished;
  const found = b.answerIds.filter(id => PB.found.has(id));
  const missing = b.answerIds.filter(id => !PB.found.has(id));
  const cleared = PB.found.size === b.count;
  const show = PB.countShown || done;

  beginPaint('playPFB');
  app.innerHTML = '';
  app.append(el(`<div>
    <div class="bar"><button class="back" id="back">‹ Back</button>
      <div class="prog"><i style="width:${show ? (PB.found.size/b.count)*100 : 0}%"></i></div>
      <span class="lives">${'●'.repeat(Math.max(0,PB.lives))}${'○'.repeat(PFB.LIVES-Math.max(0,PB.lives))}</span></div>
    <div class="vsbig">${b.sides.map(s=>`<span>${esc(s.label)}</span>`).join('<i>×</i>')}</div>
    <div class="tag" style="margin-bottom:18px">Played for <b>all ${b.sides.length}</b> ·
      ${show ? `${b.count} to find` : '? to find'} · ${PB.found.size} found</div>
    ${(found.length || (show && missing.length)) ? `<div class="legend">Appearances \u00b7
      ${abbrSet(b.sides.map(x => x.label)).map((c, i) =>
        `<b>${esc(c)}</b> ${esc(shortClub(b.sides[i].label))}`).join(' \u00b7 ')}</div>` : ''}
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
function setupQuiz(mode) {
  enterScreen();
  refreshView(mode);
  const m = MODES[mode];
  const draw = () => {
    beginPaint('setupQuiz');
    app.innerHTML = '';
    app.append(el(`<div>
      <div class="bar"><button class="back" id="back">\u2039 Back</button></div>
      <div class="kicker">${esc(m.title)}</div>
      <h1 style="font-size:30px">${esc(m.blurb)}</h1>
      <div class="tag">Ten questions.</div>
      ${eraRow(mode)}
      <button class="btn" id="go">Play</button></div>`));
    document.getElementById('back').onclick = home;
    wireEra(mode, draw);
    document.getElementById('go').onclick = () => start(mode);
  };
  draw();
}

function start(mode) {
  enterScreen();
  const daily = mode === 'daily';
  // The daily round has to be identical for everyone who plays it, so it is
  // drawn from the whole dataset regardless of what any game is filtered to.
  refreshView(daily ? null : mode);
  const rnd = mulberry32(daily ? seedFrom('daily-' + today()) : (Math.random() * 2 ** 32) >>> 0);
  const keys = daily ? Object.keys(MODES) : [mode];
  const qs = buildRound(VIEW, rnd, keys, 10);
  if (!qs.length) { app.innerHTML = '<div class="loading">Could not build a round.</div>'; return; }
  // With no names on screen a single clue is unusable, so hard mode starts
  // three rungs up the ladder.
  S = { qs, i: 0, score: 0, streak: 0, best: 0, daily,
        revealed: 3, answered: false, showedNames: false, misses: [], note: null };
  render();
}

function render() {
  const q = S.qs[S.i];
  const head = `<div class="bar">
      <button class="back" id="back">‹ Back</button>
      <div class="prog"><i style="width:${(S.i / S.qs.length) * 100}%"></i></div>
      ${S.streak > 1 ? `<span class="streak">🔥${S.streak}</span>` : ''}
      <span class="score">${S.score}/${S.qs.length}</span></div>`;
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
      body += `<button class="btn ghost" id="clue">Another clue</button>`;
  }
  // Career Path and Who Am I? always ask you to name the player. The four
  // options are one tap away on the question itself, which is where you know
  // whether you need them - a setting chosen beforehand cannot know that.
  const typed = (q.mode === 'career-path' || q.mode === 'who-am-i') && !S.answered;
  if (typed) {
    // A wrong name is a wrong guess, not the end of the question. Showing what
    // has already been tried is what makes a second guess worth having - without
    // it you lose track and retype the same name.
    if (S.note) body += `<div class="fb try"><div class="h no">Not quite</div>
      <div class="d">${esc(S.note)}</div></div>`;
    if (S.misses.length) body += `<div class="tried"><span class="lbl">Tried</span>${
      S.misses.map(m => `<span class="t">${esc(m)}</span>`).join('')}</div>`;
    body += `<div class="entry"><input id="guess" placeholder="Name the player" autocomplete="off"
      autocapitalize="words" autocorrect="off" spellcheck="false"
      ><button class="btn" id="submit">Answer</button></div>
      <div class="sugg" id="sugg" hidden></div>`;
    // A way down from hard mode without leaving it: take the four names, and
    // the answer is worth what it would have been in multiple choice.
    if (S.showedNames) {
      body += `<div class="opts">${q.options.map(o =>
        `<button class="opt" data-id="${o.id}">${esc(o.label)}</button>`).join('')}</div>`;
    } else {
      body += `<button class="btn ghost" id="shownames">Show multiple choice</button>`;
    }
    body += `<button class="btn ghost" id="giveup">Give up</button>`;
  } else if (q.mode === 'higher-lower') {
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
  beginPaint('question');
  app.innerHTML = '';
  app.append(el(`<div>${head}${body}</div>`));
  document.getElementById('back').onclick = home;
  const clue = document.getElementById('clue');
  if (clue) clue.onclick = () => { S.revealed++; render(); };
  const sn = document.getElementById('shownames');
  if (sn) sn.onclick = () => { S.showedNames = true; render(); };
  app.querySelectorAll('.opt').forEach(b => b.onclick = () => answer(b.dataset.id));

  const gi = document.getElementById('guess');
  if (gi) {
    const box = document.getElementById('sugg'), sub = document.getElementById('submit');
    let list = [], hi = -1;
    const paint = () => {
      if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      box.innerHTML = list.map((p, i) => `
        <button class="sg ${i === hi ? 'on' : ''}" data-i="${i}">
          <span class="n">${esc(p.name)}</span>
          <span class="m">${esc([p.nationality, p.position].filter(Boolean).join(' · '))}</span>
        </button>`).join('');
      // Suggestions are drawn from every player, never from the four options,
      // so they help you spell a name without hinting at the answer.
      box.querySelectorAll('.sg').forEach(x => x.onclick = () => {
        gi.value = list[x.dataset.i].name; list = []; hi = -1; paint(); gi.focus();
      });
    };
    const go = () => {
      const v = gi.value.trim(); if (!v) return;
      const p = lookup(VNAMES, v);
      // Someone excluded by the current filters should be told so, not silently
      // mismatched onto whoever happened to be the closest remaining name.
      const full = lookup(NAMES, v);
      const filteredOut = full && (!p || p.id !== full.id) && !VIEW.byId.has(full.id);
      if (p && !filteredOut && p.id === q.answerId) return answer(p.id, p.name);
      // Wrong, so say why and leave the question standing. Only Give up reveals
      // the answer - guessing badly should cost you nothing but the clue you
      // would have saved.
      if (filteredOut) S.note = `${full.name} is not in this round \u2014 your filters rule him out.`;
      else if (!p) S.note = `No player found called "${v}".`;
      else { S.note = `You said ${p.name}.`; if (!S.misses.includes(p.name)) S.misses.push(p.name); }
      gi.value = '';
      render();
    };
    gi.oninput = () => { list = suggest(VNAMES, gi.value, 6); hi = -1; paint(); };
    gi.onkeydown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!list.length) return; e.preventDefault();
        hi = e.key === 'ArrowDown' ? (hi + 1) % list.length : (hi - 1 + list.length) % list.length;
        paint();
      } else if (e.key === 'Enter') {
        if (hi >= 0 && list[hi]) { gi.value = list[hi].name; list = []; hi = -1; paint(); return; }
        go();
      }
    };
    sub.onclick = go;
    const gu = document.getElementById('giveup');
    if (gu) gu.onclick = () => answer('__none__', null);
    gi.focus();
  }
}

function answer(id, typedName) {
  if (S.answered) return;
  S.answered = true;
  const q = S.qs[S.i];
  const ok = id === q.answerId;
  const wasTyped = typedName !== undefined;
  // No points. Right or wrong, and how many in a row - clues and the four
  // names are there to be used, not priced.
  if (ok) { S.score++; S.streak++; S.best = Math.max(S.best, S.streak); } else S.streak = 0;
  for (const sel of ['.entry', '.sugg', '.fb.try', '.tried', '#shownames', '#giveup', '#clue'])
    app.querySelectorAll(sel).forEach(n => n.remove());
  app.querySelectorAll('.opt').forEach(b => {
    const isAns = b.dataset.id === q.answerId;
    b.classList.add(isAns ? 'right' : b.dataset.id === id ? 'wrong' : 'dim');
    if (q.mode === 'higher-lower') {
      const o = q.options.find(x => x.id === b.dataset.id);
      b.insertAdjacentHTML('afterbegin', `<span class="val">${o.value}</span>`);
    }
    b.onclick = null;
  });
  // Reaching here typed means the guess was right; a wrong one never resolves
  // the question. What is worth saying is how many attempts it took.
  const missNote = ok && wasTyped && S.misses.length
    ? `After ${S.misses.length} wrong ${S.misses.length === 1 ? 'guess' : 'guesses'}. `
    : '';
  app.append(el(`<div>
    <div class="fb"><div class="h ${ok ? 'ok' : 'no'}">${ok ? 'Correct' : 'Not quite'}</div>
    <div class="d">${esc(missNote)}${esc(q.fact)}</div></div>
    <button class="btn" id="next">${S.i + 1 >= S.qs.length ? 'See result' : 'Next'}</button></div>`));
  document.getElementById('next').onclick = () => {
    if (S.i + 1 >= S.qs.length) return results();
    S.i++; S.revealed = 3; S.answered = false; S.showedNames = false;
    S.misses = []; S.note = null; render();
  };
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function results() {
  if (S.daily) store.markToday();
  if (S.score > store.best) store.best = S.score;
  const max = S.qs.length * 3;
  beginPaint('results');
  app.innerHTML = '';
  app.append(el(`<div>
    <div class="big">${S.score}/${S.qs.length}</div><div class="big-sub">correct</div>
    <div class="rows">
      <div class="row"><span class="k">Best streak</span><span>${S.best}</span></div>
      <div class="row"><span class="k">Questions</span><span>${S.qs.length}</span></div>
      <div class="row"><span class="k">Best round</span><span>${store.best}/${S.qs.length}</span></div>
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
    refreshView();
    installed() ? home() : landing();
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
