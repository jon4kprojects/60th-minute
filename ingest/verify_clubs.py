#!/usr/bin/env python3
"""
Cross-check each ingested club against its known all-time appearance record.

This is the gate that decides whether a club is playable in the number-based
modes. If our parse does not reproduce the club's record holder and figure,
the club is not published - a shorter club list beats one wrong answer in a pub.
"""
import json, os, re, unicodedata

OUT = os.path.join(os.path.dirname(__file__), "out")
def norm(s):
    s = unicodedata.normalize('NFD', s)
    return re.sub(r'[^a-z ]', '', ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()).strip()

# club -> (record holder, appearances). Widely published figures, all competitions.
# Appearances alone was not enough. Manchester City reproduced Alan Oakes on 676
# and passed, while 851 of its 995 players came back on zero goals - the goals
# column of that one table parses to nothing, and Denis Law was published as
# having never scored for them. A club now has to reproduce its record scorer
# too, and a club that cannot keeps its appearances and loses its goals, which
# falls back to the league figures from player infoboxes.
TOP_SCORER = {
 "Arsenal F.C.":                 ("Thierry Henry", 228),
 "Liverpool F.C.":               ("Ian Rush", 346),
 "Chelsea F.C.":                 ("Frank Lampard", 211),
 "Manchester United F.C.":       ("Wayne Rooney", 253),
 "Manchester City F.C.":         ("Sergio Ag\u00fcero", 260),
 "Everton F.C.":                 ("Dixie Dean", 383),
 "Aston Villa F.C.":             ("Billy Walker", 244),
 "Newcastle United F.C.":        ("Alan Shearer", 206),
 "Leeds United F.C.":            ("Peter Lorimer", 238),
 "West Ham United F.C.":         ("Vic Watson", 326),
 "Tottenham Hotspur F.C.":       ("Harry Kane", 280),
 "Nottingham Forest F.C.":       ("Grenville Morris", 217),
 "Leicester City F.C.":          ("Arthur Chandler", 273),
 "Southampton F.C.":             ("Mick Channon", 228),
 "Sunderland A.F.C.":            ("Charlie Buchan", 224),
 "Celtic F.C.":                  ("Jimmy McGrory", 522),
 "Rangers F.C.":                 ("Ally McCoist", 355),
 "Wolverhampton Wanderers F.C.": ("Steve Bull", 306),
 "Derby County F.C.":            ("Steve Bloomer", 332),
 "Sheffield Wednesday F.C.":     ("Andrew Wilson", 216),
}

TRUTH = {
 "Arsenal F.C.":                 ("David O'Leary", 722),
 "Liverpool F.C.":               ("Ian Callaghan", 857),
 "Chelsea F.C.":                 ("Ron Harris", 795),
 "Manchester United F.C.":       ("Ryan Giggs", 963),
 "Manchester City F.C.":         ("Alan Oakes", 676),
 "Everton F.C.":                 ("Neville Southall", 751),
 "Aston Villa F.C.":             ("Charlie Aitken", 660),
 "Newcastle United F.C.":        ("Jimmy Lawrence", 496),
 "Leeds United F.C.":            ("Jack Charlton", 773),
 "West Ham United F.C.":         ("Billy Bonds", 799),
 "Tottenham Hotspur F.C.":       ("Steve Perryman", 854),
 "Nottingham Forest F.C.":       ("Bob McKinlay", 692),
 "Leicester City F.C.":          ("Graham Cross", 599),
 "Southampton F.C.":             ("Terry Paine", 816),
 "Sunderland A.F.C.":            ("Jim Montgomery", 627),
 "Celtic F.C.":                  ("Billy McNeill", 790),
 "Rangers F.C.":                 ("John Greig", 755),
 "Wolverhampton Wanderers F.C.": ("Derek Parkin", 609),
 "Derby County F.C.":            ("Kevin Hector", 589),
 "Sheffield Wednesday F.C.":     ("Andrew Wilson", 545),
}

# read the raw fetch, write the verified subset elsewhere: writing back over
# the input meant a second run only ever saw the already-pruned set
SRC = os.path.join(OUT, "club_stats_raw.json")
if not os.path.exists(SRC): SRC = os.path.join(OUT, "club_stats.json")
stats = json.load(open(SRC))
passed, failed, stripped = {}, [], []
for club, roster in stats.items():
    top_name, top_rec = max(roster.items(), key=lambda kv: kv[1]["apps"])
    top_apps = top_rec["apps"]
    want = TRUTH.get(club)
    if not want:
        failed.append((club, f"no reference figure", top_name, top_apps)); continue
    wn, wa = want
    # match on surname plus the figure: sources differ on given-name form
    # ("Jim" vs "Jimmy" Montgomery) while agreeing exactly on the record.
    # The right question is not "is he literally top" but "does this club's
    # known record holder appear with roughly the right figure". Sources
    # genuinely disagree on who holds some records - Leeds is cited as both
    # Bremner and Charlton on 773 - and counting of wartime and friendly games
    # varies by a game or two. Requiring the exact top name rejected good data.
    # Exact name first. Falling straight to a surname match found a different
    # Harris at Chelsea and a different McKinlay at Forest, while the actual
    # record holder sat at the top of the same list.
    entry = None
    for n, v in roster.items():
        if norm(n) == norm(wn): entry = v; break
    if entry is None:
        sur = norm(wn).split()[-1]
        cands = [v for n, v in roster.items() if norm(n).split()[-1] == sur]
        if cands: entry = min(cands, key=lambda v: abs(v["apps"] - wa))
    name_ok = entry is not None
    apps_ok = bool(entry) and abs(entry["apps"] - wa) <= max(4, wa * 0.03)
    if name_ok and apps_ok:
        # and the club's own top figure must still be plausible
        apps_ok = abs(top_apps - wa) <= max(20, wa * 0.10)
    if name_ok and apps_ok:
        # Goals are a separate claim and get a separate check. Losing them is
        # not fatal - the league figures from player infoboxes are a consistent
        # convention and stand in - so a goals failure strips goals rather than
        # the club.
        gs = TOP_SCORER.get(club)
        goals_ok = False
        if gs:
            gn, gg = gs
            gentry = None
            for n, v in roster.items():
                if norm(n) == norm(gn): gentry = v; break
            if gentry is None:
                sur = norm(gn).split()[-1]
                cands = [v for n, v in roster.items() if norm(n).split()[-1] == sur]
                if cands: gentry = min(cands, key=lambda v: abs((v.get("goals") or 0) - gg))
            goals_ok = bool(gentry) and abs((gentry.get("goals") or 0) - gg) <= max(6, gg * 0.05)
        if not goals_ok:
            roster = {n: {**v, "goals": None} for n, v in roster.items()}
            stripped.append(club)
        passed[club] = roster
        flag = "" if goals_ok else "  (goals withheld)"
        print(f"  PASS {club[:30]:30s} top {top_name[:18]:18s} {top_apps:4d} | {wn[:16]:16s} {entry['apps']:4d} (ref {wa}){flag}")
    else:
        failed.append((club, "record holder mismatch", top_name, top_apps))
        got = entry["apps"] if entry else "absent"
        print(f"  FAIL {club[:30]:30s} {wn[:18]:18s} = {got} (ref {wa}), top {top_name[:16]} {top_apps}")

json.dump(passed, open(os.path.join(OUT, "club_stats_verified.json"), "w"), separators=(",", ":"))
print(f"\nverified and published: {len(passed)}")
print(f"goals withheld:         {len(stripped)}  {', '.join(c.replace(' F.C.','') for c in stripped)}")
print(f"withheld:               {len(failed)}")
for c, why, n, a in failed:
    print(f"   {c[:30]:30s} {why} (ours: {n} {a})")
