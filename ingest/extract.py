#!/usr/bin/env python3
"""
Extract a football quiz dataset from Wikidata (CC0) via the QLever endpoint.

One-off build step. Writes ingest/out/raw_*.json for the transform stage.
Notes on the quirks this works around, all verified against live data:
  - QLever's numeric FILTER is broken after a join, so all numeric
    thresholds are applied client-side rather than in SPARQL.
  - Wikidata types national teams as football clubs, so they need an
    explicit MINUS as well as the club whitelist.
  - The club whitelist (P31/P279* -> association football club) is what
    keeps out Geoff Hurst's cricket career and the Football League XI.
"""
import json, subprocess, sys, os, time

# qlever.cs.uni-freiburg.de now 308-redirects here. curl -L follows it, but the
# extra hop is one more chance for the handshake to drop, and it drops often.
EP = "https://qlever.dev/api/wikidata"
ATTEMPTS = 12
TOP_N = int(os.environ.get("TOP_N", "2500"))
OUT = os.path.join(os.path.dirname(__file__), "out")

PREFIXES = """
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
"""

# Most-linked footballers. ORDER BY + LIMIT instead of FILTER (see module
# docstring). The tie-break on ?p matters: thousands of players share a sitelink
# count, and without a total order the window a chunk sees can shift between
# requests, so a player could be fetched twice or missed entirely.
CHUNK = int(os.environ.get("CHUNK", "20000"))

def famous(limit, offset):
    return ("{ SELECT ?p ?n WHERE { ?p wdt:P106 wd:Q937857 . ?p wikibase:sitelinks ?n } "
            f"ORDER BY DESC(?n) ?p LIMIT {limit} OFFSET {offset} }}")

FAMOUS = "%%FAMOUS%%"


def sparql(query, label):
    """POST to QLever via curl (urllib does not follow the endpoint's 308 on POST)."""
    # The endpoint refuses roughly two connections in five with an SSL syscall
    # error - not a rate limit, it never gets as far as a request. Three tries
    # was a 6% chance of abandoning a query outright, which is how a six-hour
    # extract died in its first minute. Retry hard and it costs nothing.
    t0 = time.time()
    for attempt in range(1, ATTEMPTS + 1):
        r = subprocess.run(
            ["curl", "-sSL", "-X", "POST", EP,
             "-H", "Accept: application/sparql-results+json",
             "-H", "Content-Type: application/sparql-query",
             "-H", "User-Agent: FootballQuizMVP/0.1 (one-off dataset build)",
             "--retry", "6", "--retry-delay", "3", "--retry-all-errors",
             "--max-time", "1800", "--data-binary", PREFIXES + query],
            capture_output=True, text=True)
        try:
            rows = json.loads(r.stdout)["results"]["bindings"]
            print(f"  {label:22s} {len(rows):7,d} rows  ({time.time()-t0:.1f}s)", flush=True)
            return rows
        except Exception:
            snippet = (r.stdout or r.stderr).strip()[:200]
            print(f"  {label}: attempt {attempt}/{ATTEMPTS} failed -> {snippet}",
                  file=sys.stderr, flush=True)
            if attempt == ATTEMPTS:
                raise SystemExit(f"{label}: giving up after {ATTEMPTS} attempts")
            time.sleep(min(60, 5 * attempt))


QUERIES = {
    # id -> name, fame
    # label is OPTIONAL: some very famous players (Mbappe) have no English
    # rdfs:label in the index, and an inner join silently drops them.
    "players": f"""SELECT ?p ?name ?n WHERE {{
        {FAMOUS}
        OPTIONAL {{ ?p rdfs:label ?name . FILTER(LANG(?name)='en') }}
    }}""",

    # club spells: the spine of Career Path
    "spells": f"""SELECT DISTINCT ?p ?club ?clubName ?country ?start ?end ?apps ?goals WHERE {{
        {FAMOUS}
        ?p p:P54 ?st . ?st ps:P54 ?club .
        ?club wdt:P31/wdt:P279* wd:Q476028 .
        MINUS {{ ?club wdt:P31/wdt:P279* wd:Q6979593 }}
        ?club rdfs:label ?clubName . FILTER(LANG(?clubName)='en')
        OPTIONAL {{ ?club wdt:P17 ?countryQ . ?countryQ rdfs:label ?country . FILTER(LANG(?country)='en') }}
        OPTIONAL {{ ?st pq:P580 ?start }}  OPTIONAL {{ ?st pq:P582 ?end }}
        OPTIONAL {{ ?st pq:P1350 ?apps }}  OPTIONAL {{ ?st pq:P1351 ?goals }}
    }}""",

    # national team = football nationality (better than P27: Bobby Moore's citizenship is "United Kingdom")
    "national": f"""SELECT DISTINCT ?p ?teamName ?caps ?intGoals WHERE {{
        {FAMOUS}
        ?p p:P54 ?st . ?st ps:P54 ?t .
        ?t wdt:P31/wdt:P279* wd:Q6979593 .
        ?t rdfs:label ?teamName . FILTER(LANG(?teamName)='en')
        OPTIONAL {{ ?st pq:P1350 ?caps }}  OPTIONAL {{ ?st pq:P1351 ?intGoals }}
    }}""",

    # English Wikipedia article titles: a better display name than rdfs:label
    # (labels give full legal names, and Mbappe has no English label at all)
    "titles": f"""SELECT ?p ?title WHERE {{
        {FAMOUS}
        ?art schema:about ?p .
        ?art schema:isPartOf <https://en.wikipedia.org/> .
        ?art schema:name ?title .
    }}""",

    # biography
    "bio": f"""SELECT DISTINCT ?p ?dob ?dod ?posName ?citName WHERE {{
        {FAMOUS}
        OPTIONAL {{ ?p wdt:P569 ?dob }}
        OPTIONAL {{ ?p wdt:P570 ?dod }}
        OPTIONAL {{ ?p wdt:P413 ?pos . ?pos rdfs:label ?posName . FILTER(LANG(?posName)='en') }}
        OPTIONAL {{ ?p wdt:P27 ?cit . ?cit rdfs:label ?citName . FILTER(LANG(?citName)='en') }}
    }}""",
}

def take_lock():
    """
    One extract at a time. Two runs writing raw_spells.json at once interleave
    their output into a file that is not JSON and not obviously broken either -
    it cost a full re-run to notice.
    """
    lock = os.path.join(OUT, ".extract.lock")
    if os.path.exists(lock):
        try:
            pid = int(open(lock).read().strip())
            os.kill(pid, 0)
        except (ValueError, ProcessLookupError, PermissionError):
            pass                                  # stale lock from a dead run
        else:
            raise SystemExit(f"another extract is already running (pid {pid})")
    open(lock, "w").write(str(os.getpid()))
    return lock


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    lockfile = take_lock()
    print(f"Extracting top {TOP_N:,} footballers from Wikidata via QLever")
    print(f"in chunks of {CHUNK:,}\n")
    # One request for 120,000 players' club spells is most of a gigabyte of JSON,
    # and curl's output is captured whole before it is parsed - the process was
    # being killed outright, with nothing in the log to say so. Chunking bounds
    # every response, and a chunk that fails costs one retry rather than the run.
    for name, template in QUERIES.items():
        total = 0
        out_path = os.path.join(OUT, f"raw_{name}.json")
        with open(out_path, "w") as f:
            f.write("[")
            first = True
            for offset in range(0, TOP_N, CHUNK):
                take = min(CHUNK, TOP_N - offset)
                q = template.replace("%%FAMOUS%%", famous(take, offset))
                rows = sparql(q, f"{name} {offset:,}+")
                for r in rows:
                    if not first:
                        f.write(",")
                    json.dump(r, f)
                    first = False
                total += len(rows)
                del rows
            f.write("]")
        print(f"  {name:22s} {total:9,d} rows total\n")
    os.remove(lockfile)
    print(f"Wrote raw_*.json to {OUT}")
