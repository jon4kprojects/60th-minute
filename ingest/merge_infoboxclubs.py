#!/usr/bin/env python3
"""
Add club memberships that Wikidata is missing and Wikipedia's infobox has.

James Tarkowski has played for Everton since 2022. Wikidata holds four P54
statements for him and Everton is not among them - not a parsing failure on our
side, the claim simply does not exist. His Wikipedia infobox has it, with 151
appearances, and we were already fetching that table for league figures and
then throwing the row away, because the merge only trusted an infobox club the
player was ALREADY known to have played for.

That rule was there to stop a bad name match inventing a spell. It also meant
Wikipedia could only ever confirm Wikidata, never correct it, which is the
wrong way round: the infobox is hand-maintained by people who follow the club
and is reliably the more current of the two.

Guards, since this is now a source of fact rather than an annotation:
  - the club must already exist somewhere in our data, so a parse error cannot
    conjure a club that no one has played for
  - the row must record appearances, which is what keeps youth-team lines out
    (Tarkowski's Maine Road row reads 0)
  - years are NOT invented. Career Path orders a career by date and the infobox
    rows we hold carry no dates, so these clubs join the membership layer and
    the club totals, and the dated path stays exactly as Wikidata gave it.
"""
import json, os, re, unicodedata, collections

OUT = os.path.join(os.path.dirname(__file__), "out")


def norm(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    # Periods are punctuation, not word breaks. Turning them into spaces split
    # "A.C. Milan" into "a c milan", which never matched "ac milan" - and put
    # Milan in 111 squads twice under both spellings.
    s = s.replace(".", "")
    # "Fenerbahce S.K. (football)" and "Fenerbahce S.K." are the same club; the
    # disambiguator is an artefact of Wikipedia titling, not part of the name.
    s = re.sub(r"\s*\((?:football|soccer|football club)\)\s*", " ", s)
    s = re.sub(r"\b(f\.?c\.?|a\.?f\.?c\.?|s\.?c\.?|c\.?f\.?|fc|afc)\b", " ", s)
    return re.sub(r"[^a-z0-9 ]", " ", s).replace("  ", " ").strip()


def loose(s):
    """
    A deliberately blunt form, used ONLY to recognise that a club the player
    already has is the same one the infobox is naming - "Sport Club Corinthians
    Paulista" against "S.C. Corinthians Paulista". It is never used to merge
    clubs across the dataset, because at this bluntness Barcelona S.C. of
    Guayaquil collapses onto FC Barcelona and Vitoria F.C. onto Vitoria S.C.
    Suppressing an addition is the safe direction to be wrong in; merging two
    real clubs is not.
    """
    t = norm(s)
    t = re.sub(r"\b(sport(ing)? club(e)?|futebol clube|football club|clube|club|"
               r"associacao|atletico|athletico)\b", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def main():
    data = json.load(open(os.path.join(OUT, "dataset.json")))
    league = json.load(open(os.path.join(OUT, "league_stats.json")))

    universe = {}
    for p in data["players"]:
        for c in p["allClubs"]:
            universe.setdefault(norm(c), c)

    added = players_hit = skipped_zero = unknown = 0
    for p in data["players"]:
        rows = league.get(p["id"])
        if not rows:
            continue
        known = {norm(c) for c in p["allClubs"]}
        known_loose = {loose(c) for c in p["allClubs"]}
        new = []
        for r in rows:
            n = norm(r["club"])
            if not n or n in known or loose(r["club"]) in known_loose:
                continue
            if not r.get("apps"):
                skipped_zero += 1
                continue
            club = universe.get(n)
            if not club:
                unknown += 1
                continue
            known.add(n)
            known_loose.add(loose(club))
            new.append((club, r))
        if not new:
            continue
        players_hit += 1
        for club, r in new:
            p["allClubs"].append(club)
            t = p.setdefault("clubTotals", {}).setdefault(club, {})
            t.setdefault("apps", r["apps"])
            t.setdefault("goals", r["goals"])
            t["lgApps"], t["lgGoals"] = r["apps"], r["goals"]
            added += 1
        p["allClubs"] = sorted(set(p["allClubs"]))

    open(os.path.join(OUT, "dataset.json"), "w").write(
        json.dumps(data, separators=(",", ":")))
    print(f"memberships added from infoboxes: {added:,}")
    print(f"players corrected:                {players_hit:,}")
    print(f"youth/zero-appearance rows kept out: {skipped_zero:,}")
    print(f"infobox clubs we do not hold:     {unknown:,}")


if __name__ == "__main__":
    main()
