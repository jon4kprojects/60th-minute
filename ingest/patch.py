#!/usr/bin/env python3
"""
Fill gaps in the QLever extract from live Wikidata.

QLever is fast and great for *selecting* who is famous, but its snapshot has
thin or missing statements for some entities (Mbappe had 133 sitelinks and only
one club statement). This re-fetches those players from the authoritative REST
API, then validates any newly-seen clubs back through QLever's type filter so
national teams and non-football clubs still cannot leak in.
"""
import json, os, sys, time, urllib.request, subprocess, collections

HERE = os.path.dirname(__file__); OUT = os.path.join(HERE, "out")
UA = "FootballQuizMVP/0.1 (one-off dataset build)"
MIN_SPELL_APPS = 15
load = lambda n: json.load(open(os.path.join(OUT, f"raw_{n}.json")))
V = lambda b, k: b.get(k, {}).get("value"); QID = lambda u: u.rsplit("/", 1)[-1]

def rest(url, tries=3):
    for i in range(tries):
        try:
            r = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(r, timeout=60) as x: return json.load(x)
        except Exception:
            if i == tries - 1: return None
            time.sleep(2 * (i + 1))

def ql(query):
    P = ("PREFIX wdt: <http://www.wikidata.org/prop/direct/> "
         "PREFIX wd: <http://www.wikidata.org/entity/> "
         "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ")
    r = subprocess.run(["curl", "-sSL", "-X", "POST",
        "https://qlever.cs.uni-freiburg.de/api/wikidata",
        "-H", "Accept: application/sparql-results+json",
        "-H", "Content-Type: application/sparql-query", "-H", f"User-Agent: {UA}",
        "--max-time", "120", "--data-binary", P + query], capture_output=True, text=True)
    return json.loads(r.stdout)["results"]["bindings"]

players = {QID(V(b, "p")): V(b, "name") for b in load("players")}
spells = load("spells")
def as_num(x):
    """Wikidata 'unknown value' statements come back as blank-node URIs,
    not numbers, so every numeric read has to tolerate a non-number."""
    try: return float(x)
    except (TypeError, ValueError): return None

have = collections.Counter()
for b in spells:
    n = as_num(V(b, "apps"))
    if n is not None and n >= MIN_SPELL_APPS and b.get("start"):
        have[QID(V(b, "p"))] += 1

todo = [p for p in players if have[p] < 2]
print(f"{len(players):,} famous players; {len(todo):,} need patching from live Wikidata\n")

new_spells, new_names, seen_clubs = [], {}, set()
for i, pid in enumerate(todo, 1):
    if i % 50 == 0 or i == len(todo):
        print(f"  {i}/{len(todo)}"); sys.stdout.flush()
    d = rest(f"https://www.wikidata.org/wiki/Special:EntityData/{pid}.json")
    if not d or pid not in d.get("entities", {}): continue
    e = d["entities"][pid]
    lbl = e.get("labels", {}).get("en", {}).get("value")
    if lbl and not players.get(pid): new_names[pid] = lbl
    for st in e.get("claims", {}).get("P54", []):
        dv = st["mainsnak"].get("datavalue")
        if not dv: continue
        club = dv["value"]["id"]; q = st.get("qualifiers", {})
        def t(p):
            try: return q[p][0]["datavalue"]["value"]["time"]
            except Exception: return None
        def n(p):
            try: return q[p][0]["datavalue"]["value"]["amount"].lstrip("+")
            except Exception: return None
        seen_clubs.add(club)
        new_spells.append({"p": {"value": f"http://www.wikidata.org/entity/{pid}"},
            "club": {"value": f"http://www.wikidata.org/entity/{club}"},
            "_clubQid": club, "start": {"value": t("P580")} if t("P580") else {},
            "end": {"value": t("P582")} if t("P582") else {},
            "apps": {"value": n("P1350")} if n("P1350") else {},
            "goals": {"value": n("P1351")} if n("P1351") else {}})
    time.sleep(0.12)

# validate newly-seen clubs through the same type filter used in extract.py
print(f"\nvalidating {len(seen_clubs):,} clubs seen in patched data...")
ok, labels = set(), {}
CH = 400
cl = sorted(seen_clubs)
for i in range(0, len(cl), CH):
    vals = " ".join(f"wd:{c}" for c in cl[i:i+CH])
    for b in ql(f"SELECT DISTINCT ?c ?l WHERE {{ VALUES ?c {{ {vals} }} "
                f"?c wdt:P31/wdt:P279* wd:Q476028 . "
                f"MINUS {{ ?c wdt:P31/wdt:P279* wd:Q6979593 }} "
                f"?c rdfs:label ?l . FILTER(LANG(?l)='en') }}"):
        q = QID(V(b, "c")); ok.add(q); labels[q] = V(b, "l")
print(f"  {len(ok):,} are genuine football clubs (national teams/other filtered out)")

kept = []
for s in new_spells:
    c = s.pop("_clubQid")
    if c in ok:
        s["clubName"] = {"value": labels[c]}; kept.append(s)
print(f"  kept {len(kept):,} patched club spells")

json.dump(spells + kept, open(os.path.join(OUT, "raw_spells.json"), "w"))
if new_names:
    ps = load("players")
    for b in ps:
        q = QID(V(b, "p"))
        if q in new_names and not V(b, "name"): b["name"] = {"value": new_names[q]}
    json.dump(ps, open(os.path.join(OUT, "raw_players.json"), "w"))
    print(f"  recovered {len(new_names):,} missing player names")
print("\ndone")
