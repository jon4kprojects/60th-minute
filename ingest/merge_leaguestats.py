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

def norm(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r'\b(f\.?c\.?|a\.?f\.?c\.?|s\.?c\.?|c\.?f\.?|fc|afc)\b', ' ', s.lower())
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

data["leagueScopeClubs"] = sorted(c for c in ver if tot[c] and cov[c] / tot[c] >= 0.5)
open(os.path.join(OUT, "dataset.json"), "w").write(json.dumps(data, separators=(",", ":")))

print(f"players given league figures: {players_hit:,}")
print(f"club rows written:            {applied:,}")
print(f"infobox clubs not recognised: {unmatched:,}")
print(f"\nleague coverage at verified clubs:")
for c in sorted(ver):
    n, w = tot[c], cov[c]
    print(f"   {c.replace(' F.C.','')[:26]:26s} {w:4d}/{n:<4d} {'OFFERED' if n and w/n >= 0.5 else ''}")
print(f"\nclubs where the league option is offered: {len(data['leagueScopeClubs'])} of {len(ver)}")
