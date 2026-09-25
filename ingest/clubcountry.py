#!/usr/bin/env python3
"""
Club -> country, resolved well enough to define "the top five leagues".

Wikidata's P17 says United Kingdom for Arsenal and for Celtic alike, so country
alone cannot separate England from Scotland. The club's league (P118) can:
"Premier League" and "Scottish Premiership" are unambiguous where "United
Kingdom" is not.
"""
import json, os, re, subprocess

OUT = os.path.join(os.path.dirname(__file__), "out")
EP = "https://qlever.cs.uni-freiburg.de/api/wikidata"
PREFIX = ("PREFIX wdt: <http://www.wikidata.org/prop/direct/> "
          "PREFIX wd: <http://www.wikidata.org/entity/> "
          "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ")

def ql(q):
    r = subprocess.run(["curl", "-sSL", "-X", "POST", EP,
        "-H", "Accept: application/sparql-results+json",
        "-H", "Content-Type: application/sparql-query",
        "-H", "User-Agent: 60thMinute/0.1", "--max-time", "300",
        "--data-binary", PREFIX + q], capture_output=True, text=True)
    return json.loads(r.stdout)["results"]["bindings"]

rows = ql("""SELECT ?name ?country ?league WHERE {
  ?c wdt:P31/wdt:P279* wd:Q476028 .
  ?c rdfs:label ?name . FILTER(LANG(?name)='en')
  OPTIONAL { ?c wdt:P17 ?co . ?co rdfs:label ?country . FILTER(LANG(?country)='en') }
  OPTIONAL { ?c wdt:P118 ?l . ?l rdfs:label ?league . FILTER(LANG(?league)='en') }
}""")
print(f"club rows: {len(rows):,}")

V = lambda b, k: b.get(k, {}).get("value")
# league-name patterns that pin down a country the P17 value cannot
ENGLISH = re.compile(r"\b(premier league|efl|football league|national league|"
                     r"championship|league one|league two|isthmian|northern premier|southern league)\b", re.I)
NOT_ENGLISH = re.compile(r"\b(scottish|welsh|irish|cymru|highland|lowland)\b", re.I)
TOP5 = {"Spain": "Spain", "Italy": "Italy", "Germany": "Germany", "France": "France"}

out = {}
for b in rows:
    name, co, lg = V(b, "name"), V(b, "country"), V(b, "league") or ""
    if not name: continue
    country = None
    if co in TOP5:
        country = TOP5[co]
    elif co == "United Kingdom":
        if NOT_ENGLISH.search(lg): country = None
        elif ENGLISH.search(lg):   country = "England"
    if country and name not in out:
        out[name] = country

json.dump(out, open(os.path.join(OUT, "club_country.json"), "w"), separators=(",", ":"))
from collections import Counter
print("clubs mapped to a top-five country:", len(out))
for k, v in Counter(out.values()).most_common(): print(f"   {k:10s} {v}")
