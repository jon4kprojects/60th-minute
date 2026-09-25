// Dataset loading + the derived indexes the generators need.
let DB = null;

// ---- offline-first data layer -------------------------------------------
// Gameplay never depends on the network. The device holds a football dataset
// and plays from it; when there IS a connection the app asks only for a tiny
// version file, and downloads a new dataset solely when the version differs.
// The downloaded copy lives in the Cache API and supersedes the bundled one,
// so football data can be updated without shipping a new build of the app.
const DATA_CACHE = 'm60-data';
const VKEY = 'm60-data-version';

const installed = () => { try { return localStorage.getItem(VKEY); } catch { return null; } };
const setInstalled = (v) => { try { localStorage.setItem(VKEY, v); } catch {} };

async function cachedPayload() {
  const v = installed();
  if (!v || !self.caches) return null;
  try {
    const c = await caches.open(DATA_CACHE);
    const hit = await c.match('data-' + v);
    return hit ? await hit.json() : null;
  } catch { return null; }
}

/**
 * Check for a newer published dataset. Silent and entirely optional: any
 * failure (offline, DNS, 404) leaves the device on the copy it already has.
 * Returns the new version string if one was downloaded.
 */
export async function checkForUpdate() {
  if (!self.caches || !navigator.onLine) return null;
  try {
    const r = await fetch('./data/version.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const meta = await r.json();
    if (!meta.version || meta.version === installed()) return null;
    const d = await fetch('./data/dataset.json', { cache: 'no-store' });
    if (!d.ok) return null;
    const body = await d.clone().json();
    if (!body.players || !body.players.length) return null;   // never install an empty set
    const c = await caches.open(DATA_CACHE);
    await c.put('data-' + meta.version, d);
    const old = installed();
    setInstalled(meta.version);
    if (old) await c.delete('data-' + old);
    return meta.version;
  } catch { return null; }
}

export async function loadData() {
  if (DB) return DB;
  let raw = await cachedPayload();
  if (!raw) {
    const res = await fetch('./data/dataset.json');
    if (!res.ok) throw new Error('dataset unavailable');
    raw = await res.json();
    if (raw.version) setInstalled(raw.version);
  }
  const players = raw.players.filter(p => p.name && p.clubs && p.clubs.length);
  DB = {
    version: raw.version || 'bundled',
    // Clubs whose figures come from a single source with one definition.
    // Number-based modes offer these and nothing else.
    verifiedClubs: new Set(raw.verifiedClubs || []),
    // clubs where enough players have league-only figures to offer the choice
    leagueScopeClubs: new Set(raw.leagueScopeClubs || []),
    // Clubs Football 501 can offer at all: verified ones have all-competition
    // figures too, the rest are playable on league figures alone.
    playableClubs: new Set(raw.playableClubs || raw.verifiedClubs || []),
    statScope: raw.statScope || null,
    statSource: raw.statSource || null,
    built: raw.built || null,
    players,
    byId: new Map(players.map(p => [p.id, p])),
    // fame tiers drive difficulty and, critically, decoy plausibility:
    // a decoy must be about as well known as the answer or the question is trivial.
    tier: (p) => (p.fame >= 75 ? 0 : p.fame >= 55 ? 1 : 2),
    // career midpoint: a much tighter era match than decade-of-first-club,
    // which let Bellingham be offered against Vidic.
    mid: (p) => p.mid,
    decade: (p) => {
      const y = p.clubs.map(c => c.from).filter(Boolean);
      return y.length ? Math.floor(Math.min(...y) / 10) * 10 : null;
    },
  };
  buildIndexes(DB);
  DB.topFiveClubs = new Set(raw.topFiveClubs || []);
  DB.clubCountry = raw.clubCountry || {};
  return DB;
}

function buildIndexes(DB) {
  const players = DB.players;
  DB.byId = new Map(players.map(p => [p.id, p]));
  DB.byClub = new Map();
  DB.byNation = new Map();
  for (const p of players) {
    // membership uses allClubs (every spell), not the display-filtered list
    for (const club of (p.allClubs || p.clubs.map(c => c.club))) {
      if (!DB.byClub.has(club)) DB.byClub.set(club, new Set());
      DB.byClub.get(club).add(p.id);
    }
    if (p.nationality) {
      if (!DB.byNation.has(p.nationality)) DB.byNation.set(p.nationality, new Set());
      DB.byNation.get(p.nationality).add(p.id);
    }
  }
  // A club's prominence is how many well-known players it has, not the squad
  // average - averaging punishes big clubs for having deep squads.
  const known = (set) => [...set].filter(id => DB.byId.get(id).fame >= 60).length;
  DB.clubProm = new Map([...DB.byClub].map(([c, s]) => [c, known(s)]));
  DB.natProm = new Map([...DB.byNation].map(([c, s]) => [c, known(s)]));
  return DB;
}

/**
 * A filtered view of the dataset, used before a round starts.
 *
 * Returns a real db-shaped object with its own indexes rather than passing
 * filters down into every generator - a generator that forgot to apply one
 * would quietly serve players the filter was meant to exclude.
 */
export function filterDB(db, { since = null, topFive = false } = {}) {
  if (!since && !topFive) return db;
  let players = db.players;
  if (since) {
    // A dataset without debut years would otherwise filter down to nobody and
    // leave every game unplayable. Fail open, not silently empty.
    const withDebut = players.filter(p => p.debut);
    if (withDebut.length < players.length * 0.5) return db;
    players = withDebut.filter(p => p.debut >= since);
  }
  if (topFive) {
    const t5 = db.topFiveClubs;
    players = players.filter(p => (p.allClubs || []).some(c => t5.has(c)));
  }
  const view = Object.assign(Object.create(Object.getPrototypeOf(db)), db, { players });
  // a top-five round should not offer clubs outside it either
  if (topFive) {
    view.players = players.map(p => ({
      ...p,
      allClubs: (p.allClubs || []).filter(c => db.topFiveClubs.has(c)),
      clubs: p.clubs.filter(c => db.topFiveClubs.has(c.club)),
    })).filter(p => p.allClubs.length);
  }
  if (!view.players.length) return db;      // never hand back an empty game
  buildIndexes(view);
  view.playableClubs = new Set([...db.playableClubs].filter(c => !topFive || db.topFiveClubs.has(c)));
  view.verifiedClubs = new Set([...db.verifiedClubs].filter(c => !topFive || db.topFiveClubs.has(c)));
  view.leagueScopeClubs = new Set([...db.leagueScopeClubs].filter(c => !topFive || db.topFiveClubs.has(c)));
  return view;
}

export const shortClub = (name) => name
  .replace(/\s+(F\.?C\.?|A\.?F\.?C\.?|S\.?C\.?|C\.?F\.?|B\.?C\.?)$/i, '')
  .replace(/^(F\.?C\.?|A\.?F\.?C\.?|S\.?C\.?|C\.?F\.?)\s+/i, '')
  .replace(/\s+(Club de Fútbol|Football Club|Calcio)$/i, '')
  .trim();
