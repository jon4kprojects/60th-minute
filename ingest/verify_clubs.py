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
passed, failed = {}, []
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
        passed[club] = roster
        print(f"  PASS {club[:30]:30s} top {top_name[:18]:18s} {top_apps:4d} | {wn[:16]:16s} {entry['apps']:4d} (ref {wa})")
    else:
        failed.append((club, "record holder mismatch", top_name, top_apps))
        got = entry["apps"] if entry else "absent"
        print(f"  FAIL {club[:30]:30s} {wn[:18]:18s} = {got} (ref {wa}), top {top_name[:16]} {top_apps}")

json.dump(passed, open(os.path.join(OUT, "club_stats_verified.json"), "w"), separators=(",", ":"))
print(f"\nverified and published: {len(passed)}")
print(f"withheld:               {len(failed)}")
for c, why, n, a in failed:
    print(f"   {c[:30]:30s} {why} (ours: {n} {a})")
