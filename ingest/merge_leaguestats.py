#!/usr/bin/env python3
"""
Fold league-only figures from player infoboxes into clubTotals.

Club lists give all-competition totals; player infoboxes give league figures
for the same club. Holding both is what makes the league / all-competitions
choice real rather than a setting the data cannot honour.

Matching is deliberately conservative: an infobox club is only accepted if the
player is already known to have played there, so a bad link cannot invent a
spell.
"""
import json, os, re, unicodedata, collections

OUT = os.path.join(os.path.dirname(__file__), "out")

# Club-type words must all come off, in every language a Wikipedia title might
# use them: our dataset calls it "Real Madrid Club de Futbol" while infoboxes
# link "Real Madrid CF", and stripping only the abbreviation matched 1 of 234.
CLUB_WORDS = re.compile(
    r"\b(f\.?c\.?|a\.?f\.?c\.?|s\.?c\.?|c\.?f\.?|fc|afc|cf|sc|ac|as|ss|ssc|rc|cd|ud|sv|vfb|vfl|"
    r"club|clube|futbol|futebol|football|calcio|sport|sportiv[ao]|deportivo|atletico|"
    r"de|del|la|le|les|el|of|the)\b", re.I)

def norm(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = CLUB_WORDS.sub(' ', s.lower())
    return re.sub(r'[^a-z0-9 ]', ' ', s).replace('  ', ' ').strip()

data = json.load(open(os.path.join(OUT, "dataset.json")))
league = json.load(open(os.path.join(OUT, "league_stats.json")))

applied = players_hit = unmatched = 0
for p in data["players"]:
    rows = league.get(p["id"])
    if not rows: continue
    known = {norm(c): c for c in (p.get("allClubs") or [])}
    acc = collections.defaultdict(lambda: [0, 0])
    for r in rows:
        club = known.get(norm(r["club"]))
        if not club:
            unmatched += 1
            continue
        # a player can have several infobox rows for one club (a loan return);
        # league totals for that club are their sum
        acc[club][0] += r["apps"]
        acc[club][1] += r["goals"]
    if not acc: continue
    players_hit += 1
    totals = p.setdefault("clubTotals", {})
    for club, (a, g) in acc.items():
        t = totals.setdefault(club, {"apps": a, "goals": g})
        t["lgApps"], t["lgGoals"] = a, g
        applied += 1

ver = set(data.get("verifiedClubs", []))
cov = collections.Counter(); tot = collections.Counter()
for p in data["players"]:
    for club, t in (p.get("clubTotals") or {}).items():
        if club not in ver: continue
        tot[club] += 1
        if "lgApps" in t: cov[club] += 1

# Clubs playable in Football 501. A verified club has all-competition figures
# from its player list AND league figures from infoboxes, so it offers both
# scopes. Everything else with solid infobox coverage is playable on league
# figures alone - that is what lets Real Madrid and Dortmund in, rather than
# scraping a hundred more club pages.
allcov = collections.Counter(); alltot = collections.Counter()
for p in data["players"]:
    for club, t in (p.get("clubTotals") or {}).items():
        alltot[club] += 1
        if "lgApps" in t: allcov[club] += 1

league_ok = sorted(c for c in alltot
                   if alltot[c] >= 12 and allcov[c] / alltot[c] >= 0.5)
data["leagueScopeClubs"] = league_ok
data["playableClubs"] = sorted(set(league_ok) | ver)

# Clubs in the five big leagues, for the Played for Both filter. P17 alone
# cannot do this - it says United Kingdom for Arsenal and Celtic alike - so the
# mapping comes from the club's league as well as its country.
try:
    cc = json.load(open(os.path.join(OUT, "club_country.json")))
except Exception:
    cc = {}
held = {club for p in data["players"] for club in (p.get("allClubs") or [])}
data["topFiveClubs"] = sorted(c for c in held if cc.get(c))
data["clubCountry"] = {c: cc[c] for c in data["topFiveClubs"]}

# Career start year, so an era filter does not have to recompute it per round.
for p in data["players"]:
    ys = [c["from"] for c in p["clubs"] if c.get("from")]
    p["debut"] = min(ys) if ys else None
open(os.path.join(OUT, "dataset.json"), "w").write(json.dumps(data, separators=(",", ":")))

print(f"players given league figures: {players_hit:,}")
print(f"club rows written:            {applied:,}")
print(f"infobox clubs not recognised: {unmatched:,}")
print(f"\nleague coverage at verified clubs:")
for c in sorted(ver):
    n, w = tot[c], cov[c]
    print(f"   {c.replace(' F.C.','')[:26]:26s} {w:4d}/{n:<4d} {'OFFERED' if n and w/n >= 0.5 else ''}")
print(f"\nclubs where the league option is offered: {len(data['leagueScopeClubs'])} of {len(ver)}")
