// Dataset loading + the derived indexes the generators need.
let DB = null;

export async function loadData() {
  if (DB) return DB;
  const res = await fetch('./data/dataset.json');
  if (!res.ok) throw new Error('dataset unavailable');
  const raw = await res.json();
  const players = raw.players.filter(p => p.name && p.clubs && p.clubs.length);
  DB = {
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
  return DB;
}

export const shortClub = (name) => name
  .replace(/\s+(F\.?C\.?|A\.?F\.?C\.?|S\.?C\.?|C\.?F\.?|B\.?C\.?)$/i, '')
  .replace(/^(F\.?C\.?|A\.?F\.?C\.?|S\.?C\.?|C\.?F\.?)\s+/i, '')
  .replace(/\s+(Club de Fútbol|Football Club|Calcio)$/i, '')
  .trim();
