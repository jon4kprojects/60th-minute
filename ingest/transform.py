#!/usr/bin/env python3
"""
Normalise the raw Wikidata extract into the game's dataset.json.

Rules enforced here (each one exists because live data broke without it):
  - Career-apps floor removes people famous for something else who played a
    bit of football (Camus, Niels Bohr, Sean Connery all cleared this way).
  - Tiny spells are dropped from the displayed career path: they are usually
    loans or twilight cameos and they make Career Path unguessable.
  - Consecutive duplicate clubs are collapsed (Henry rejoining Arsenal in 2012).
  - Football nationality comes from the senior national team, not citizenship,
    because Wikidata records Bobby Moore's citizenship as "United Kingdom".
"""
import json, os, re, collections

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "out")

RESERVE_RE = re.compile(
    r"(\sB$|\sII$|\bReserves?\b|\bU-?\d\d\b|\bYouth\b|\bAcademy\b"
    r"|Atl[eè]tic$|Castilla|\bB team\b|\bAmateure\b|\bII$)", re.I)

# Wikidata has year-shaped typos in appearance fields (Maldini is recorded with
# 1987 appearances for Milan; he made 902). The all-time single-club record is
# around 1000, so anything past this is a data-entry error, not a career.
MAX_CLUB_APPS = 1100

MIN_CAREER_APPS = 150   # separates footballers from famous people who played a bit
MIN_SPELL_APPS  = 15    # below this, a spell is noise in a career path
MIN_CLUBS       = 1     # keep one-club legends (Giggs, Totti, Maldini):
                        # Football 501 needs them, and Career Path filters
                        # for >=3 clubs at generation time anyway

load = lambda n: json.load(open(os.path.join(OUT, f"raw_{n}.json")))
V    = lambda b, k: b.get(k, {}).get("value")
QID  = lambda u: u.rsplit("/", 1)[-1]

def num(x):
    try: return int(float(x))
    except (TypeError, ValueError): return None

def year(x):
    """Wikidata has malformed dates (Roberto Carlos has an Anzhi spell starting
    in year 1); anything outside a plausible football window is treated as absent."""
    if not x: return None
    m = re.match(r"^[+-]?(\d{4})", x)
    if not m: return None
    y = int(m.group(1))
    return y if 1870 <= y <= 2030 else None

SENIOR_SKIP = ("under-", "under ", "olympic", " b national", "amateur", "youth")
def nationality(team):
    t = team.lower()
    if any(s in t for s in SENIOR_SKIP): return None
    t = re.sub(r"\b(men's|women's)\s+", "", team)
    for suf in (" national association football team", " national football team",
                " national association football", " national team"):
        if suf in t: return t.split(suf)[0].strip()
    return None

# --- assemble -----------------------------------------------------------
# Wikipedia article title is the preferred display name: it is the name people
# actually use, and some players (Mbappe) have no English rdfs:label at all.
titles = {}
for b in load("titles"):
    t = V(b, "title")
    if t:
        titles[QID(V(b, "p"))] = re.sub(r"\s*\([^)]*\)\s*$", "", t).strip()

players = {}
for b in load("players"):
    pid = QID(V(b, "p"))
    players[pid] = {"id": pid, "name": titles.get(pid) or V(b, "name"),
                    "fame": num(V(b, "n")) or 0}

bio = collections.defaultdict(lambda: {"pos": set(), "cit": set()})
for b in load("bio"):
    p = QID(V(b, "p")); r = bio[p]
    if V(b, "dob"): r["dob"] = year(V(b, "dob"))
    if V(b, "dod"): r["dod"] = year(V(b, "dod"))
    if V(b, "posName"): r["pos"].add(V(b, "posName"))
    if V(b, "citName"): r["cit"].add(V(b, "citName"))

nat = collections.defaultdict(list)
for b in load("national"):
    n = nationality(V(b, "teamName") or "")
    if n: nat[QID(V(b, "p"))].append((num(V(b, "caps")) or 0, n))

suspect_apps = 0
had_apps_stmt = set()   # players Wikidata records SOME appearance figure for
spells = collections.defaultdict(list)
for b in load("spells"):
    _a = num(V(b, "apps"))
    _had_apps = _a is not None
    if _a is not None and _a > MAX_CLUB_APPS:
        _a = None; suspect_apps += 1
    if _had_apps: had_apps_stmt.add(QID(V(b, "p")))
    spells[QID(V(b, "p"))].append({
        "club": V(b, "clubName"), "clubId": QID(V(b, "club")),
        "country": V(b, "country"),
        "start": year(V(b, "start")), "end": year(V(b, "end")),
        "apps": _a, "goals": num(V(b, "goals"))})

# --- filter + shape -----------------------------------------------------
POS_ORDER = ["goalkeeper", "defender", "centre-back", "full-back", "midfielder",
             "defensive midfielder", "attacking midfielder", "winger", "forward",
             "centre-forward", "striker"]
def best_pos(s):
    for p in POS_ORDER:
        for c in s:
            if c.lower() == p: return c.title()
    return sorted(s)[0].title() if s else None

out, rejected = [], collections.Counter()
for pid, p in players.items():
    if not p["name"]:
        rejected["no usable name"] += 1; continue
    raw = spells.get(pid, [])
    career_apps = sum(s["apps"] or 0 for s in raw)
    # The floor is there to drop people famous for something else who played a
    # bit (Camus, Niels Bohr) - they have no appearance statements at all.
    # Someone like Maldini, whose only figure was a typo, is a real footballer
    # with unusable stats: keep him, but withhold the numbers.
    no_stats = False
    if career_apps < MIN_CAREER_APPS:
        if pid in had_apps_stmt and p["fame"] >= 55:
            no_stats = True
        else:
            rejected["too few career apps"] += 1; continue

    # keep meaningful, dated spells; order them; collapse consecutive repeats
    keep = [s for s in raw
            if s["start"] and not RESERVE_RE.search(s["club"] or "")
            and ((s["apps"] or 0) >= MIN_SPELL_APPS or no_stats)]
    keep.sort(key=lambda s: (s["start"], s["end"] or s["start"]))
    path = []
    for s in keep:
        if path and path[-1]["clubId"] == s["clubId"]:
            path[-1]["apps"]  = (path[-1]["apps"] or 0) + (s["apps"] or 0)
            path[-1]["goals"] = (path[-1]["goals"] or 0) + (s["goals"] or 0)
            path[-1]["end"]   = s["end"] or path[-1]["end"]
            continue
        path.append(dict(s))
    if len(path) < MIN_CLUBS:
        rejected["too few clubs"] += 1; continue

    b = bio.get(pid, {})
    natl = sorted(nat.get(pid, []), reverse=True)
    out.append({
        "id": pid, "name": p["name"], "fame": p["fame"],
        "born": b.get("dob"), "died": b.get("dod"),
        "position": best_pos(b.get("pos", set())),
        "nationality": natl[0][1] if natl else None,
        "caps": natl[0][0] if natl and natl[0][0] else None,
        "noStats": no_stats,
        "careerApps": None if no_stats else career_apps,
        "careerGoals": None if no_stats else sum(s["goals"] or 0 for s in raw),
        # flagged when the ratio is implausible for official records, so
        # Higher/Lower can skip it rather than ask an unfair question
        "statsSuspect": no_stats or bool(career_apps and
            sum(s["goals"] or 0 for s in raw) / career_apps > 0.9),
        "mid": (lambda ys: (min(ys) + max(ys)) // 2 if ys else None)(
            [y for s2 in path for y in (s2["start"], s2["end"] or s2["start"]) if y]),
        "clubs": [{"club": s["club"], "country": s["country"], "from": s["start"],
                   "to": s["end"], "apps": s["apps"], "goals": s["goals"]} for s in path],
    })

out.sort(key=lambda p: -p["fame"])
os.makedirs(OUT, exist_ok=True)
json.dump({"generated": "wikidata-qlever", "players": out},
          open(os.path.join(OUT, "dataset.json"), "w"), separators=(",", ":"))

# --- report -------------------------------------------------------------
size = os.path.getsize(os.path.join(OUT, "dataset.json"))
print(f"players kept        {len(out):,}")
print(f"  implausible appearance figures dropped: {suspect_apps:,}")
for k, v in rejected.most_common(): print(f"  rejected: {k:22s} {v:,}")
print(f"\nclubs (distinct)    {len({c['club'] for p in out for c in p['clubs']}):,}")
print(f"club spells         {sum(len(p['clubs']) for p in out):,}")
print(f"dataset.json        {size/1024:.0f} KB raw")
miss = lambda f: sum(1 for p in out if not p.get(f))
print(f"\nmissing nationality {miss('nationality'):,}"
      f"\nmissing position    {miss('position'):,}"
      f"\nmissing birth year  {miss('born'):,}")
eras = collections.Counter()
for p in out:
    y = min((c["from"] for c in p["clubs"] if c["from"]), default=None)
    if y: eras[f"{y//10*10}s"] += 1
print("\ncareer start decade:")
for d in sorted(eras): print(f"  {d}  {eras[d]:,}")
