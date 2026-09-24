#!/usr/bin/env python3
"""
Overlay verified Wikipedia club figures onto the dataset.

Only clubs present in club_stats.json get verified numbers, and only those
clubs are offered in the number-based modes. A club we have not verified is
simply not playable there - a shorter club list beats one wrong answer.

Every verified figure means the same thing: total competitive appearances and
goals for that club. That single definition is what makes the number defensible
when someone checks it on their phone.
"""
import json, os, re, unicodedata, collections

HERE = os.path.dirname(__file__); OUT = os.path.join(HERE, "out")

def norm(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z ]', '', s.lower()).strip()

data = json.load(open(os.path.join(OUT, "dataset.json")))
stats = json.load(open(os.path.join(OUT, "club_stats_verified.json")))
players = data["players"]

# index our players by normalised name
by_name = collections.defaultdict(list)
for p in players:
    by_name[norm(p["name"])].append(p)

verified, applied, unmatched = [], 0, 0
for club, roster in stats.items():
    wiki = {norm(n): v for n, v in roster.items()}
    hits = 0
    for p in players:
        if not any(c["club"] == club for c in p["clubs"]): continue
        w = wiki.get(norm(p["name"]))
        if not w: continue
        # Stored once per club, not per spell. Drogba had two Chelsea spells and
        # writing the club total onto each made him read 328 goals instead of 164.
        rec = {"apps": w["apps"], "goals": w["goals"]}
        # league-only figures where the source page breaks them out
        if w.get("lgApps") is not None: rec["lgApps"] = w["lgApps"]
        if w.get("lgGoals") is not None: rec["lgGoals"] = w["lgGoals"]
        p.setdefault("clubTotals", {})[club] = rec
        hits += 1
    applied += hits
    verified.append({"club": club, "roster": len(roster), "matched": hits})
    print(f"  {club[:30]:30s} wikipedia {len(roster):4d} players, matched {hits:3d} of ours")

data["verifiedClubs"] = sorted(v["club"] for v in verified)
lg = sum(1 for p in players for t in (p.get("clubTotals") or {}).values() if "lgApps" in t or "lgGoals" in t)
data["statScope"] = "Competitive appearances and goals for the club"
data["leagueSplits"] = lg
data["statSource"] = "Wikipedia club player lists (CC BY-SA)"

body = json.dumps(data, separators=(",", ":"))
open(os.path.join(OUT, "dataset.json"), "w").write(body)
print(f"\nverified clubs: {len(verified)}   figures replaced: {applied:,}")
