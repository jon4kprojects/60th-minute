#!/usr/bin/env python3
"""
Authoritative per-club appearance/goal figures from Wikipedia club player lists.

Why this exists: our Wikidata figures are inconsistently scoped. Most look like
league appearances, some are all-competitions, and a few are neither (Drogba
came out at 28 Chelsea appearances against a real 381). A quiz cannot defend a
number like that, so club stats come from ONE source publishing ONE definition:
total competitive appearances.

Only clubs that parse cleanly AND pass a sanity check are published. Everything
else is left out rather than shipped wrong.
"""
import json, os, re, sys, time, unicodedata, urllib.request, urllib.parse
from html.parser import HTMLParser

HERE = os.path.dirname(__file__); OUT = os.path.join(HERE, "out")
UA = "60thMinute/0.1 (one-off dataset build; football quiz prototype)"

_last = [0.0]
def api(params, tries=5):
    """Wikipedia rate-limits anonymous callers; pace requests and back off on 429.
    Without this, clubs silently came back empty and looked like parse failures."""
    u = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params)
    for attempt in range(tries):
        gap = time.time() - _last[0]
        if gap < 1.1: time.sleep(1.1 - gap)
        _last[0] = time.time()
        try:
            r = urllib.request.Request(u, headers={"User-Agent": UA})
            with urllib.request.urlopen(r, timeout=90) as x:
                return json.load(x)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == tries - 1: raise
            wait = 5 * (attempt + 1)
            print(f"      rate-limited, waiting {wait}s", file=sys.stderr)
            time.sleep(wait)
        except Exception:
            if attempt == tries - 1: raise
            time.sleep(3)
    raise RuntimeError("unreachable")

class Tables(HTMLParser):
    def __init__(s): super().__init__(); s.tables=[]; s.cur=None; s.row=None; s.cell=None
    def handle_starttag(s,t,a):
        if t=='table': s.cur=[]
        elif t=='tr' and s.cur is not None: s.row=[]
        elif t in ('td','th') and s.row is not None: s.cell=[]
    def handle_endtag(s,t):
        if t=='table' and s.cur is not None: s.tables.append(s.cur); s.cur=None
        elif t=='tr' and s.row is not None:
            if s.row: s.cur.append(s.row)
            s.row=None
        elif t in ('td','th') and s.cell is not None:
            s.row.append(re.sub(r'\s+',' ',''.join(s.cell)).strip()); s.cell=None
    def handle_data(s,d):
        if s.cell is not None: s.cell.append(d)

APPS_COLS  = ('total','appearances','apps','apps.','matches','games')
GOALS_COLS = ('goals','goals.','gls')
NAME_COLS  = ('player','name')

def parse_page(title):
    """Return [(name, apps, goals)] from the biggest sensible table on a page."""
    try:
        d = api({"action":"parse","page":title,"prop":"text","format":"json","formatversion":"2"})
    except Exception:
        return []
    if "parse" not in d: return []
    p = Tables(); p.feed(d["parse"]["text"])
    best = []
    for tb in sorted(p.tables, key=len, reverse=True):
        if len(tb) < 15: continue
        hdr = [h.lower().strip() for h in tb[0]]
        def col(opts):
            for i,h in enumerate(hdr):
                if h in opts: return i
            return None
        ci, ca, cg = col(NAME_COLS), col(APPS_COLS), col(GOALS_COLS)
        if ci is None or ca is None: continue
        rows = []
        for r in tb[1:]:
            if len(r) <= max(ci, ca): continue
            nm = re.sub(r'\[\d+\]|\(.*?\)', '', r[ci]).strip()
            if len(nm) < 3: continue
            m = re.search(r'\d+', r[ca])
            if not m: continue
            apps = int(m.group())
            if apps <= 0 or apps > 1000: continue   # nobody has played 1000+ for one club
            goals = 0
            if cg is not None and cg < len(r):
                mg = re.search(r'\d+', r[cg]); goals = int(mg.group()) if mg else 0
            rows.append((nm, apps, goals))
        if len(rows) > len(best): best = rows
    return best

def find_pages(club):
    """Club lists live under several titles and are often split by appearance band."""
    base = club.replace(' F.C.','').replace(' A.F.C.','').replace(' FC','')
    cands = [f"List of {club} players", f"List of {base} F.C. players", f"List of {base} players"]
    try:
        d = api({"action":"query","list":"search","srsearch":f'intitle:"List of" intitle:"{base}" players',
                 "srlimit":8,"format":"json","formatversion":"2"})
        for h in d["query"]["search"]:
            t = h["title"]; tl = t.lower()
            if not tl.startswith("list of"): continue
            if any(x in tl for x in ("international","manager","transfer","captain","records")): continue
            if base.lower().split()[0] not in tl: continue
            cands.append(t)
    except Exception: pass
    seen, out = set(), []
    for c in cands:
        if c not in seen: seen.add(c); out.append(c)
    return out

def club_rows(club):
    """Merge every band page for a club; the same player may appear once only."""
    merged = {}
    for t in find_pages(club):
        for nm, a, g in parse_page(t):
            if nm not in merged or a > merged[nm][0]:
                merged[nm] = (a, g)
    return merged

if __name__ == "__main__":
    clubs = json.load(open(os.path.join(HERE, "clubs_to_fetch.json")))
    out, skipped = {}, []
    for our_name, wiki_club in clubs.items():
        rows = club_rows(wiki_club)
        # sanity: a real club list has a decent roster and a plausible top figure
        top = max((a for a,_ in rows.values()), default=0)
        if len(rows) < 40 or top < 200 or top > 1000:
            skipped.append((our_name, len(rows), top)); print(f"  SKIP {our_name[:30]:30s} {len(rows):4d} rows, top {top}")
            continue
        out[our_name] = {n: {"apps": a, "goals": g} for n,(a,g) in rows.items()}
        print(f"  OK   {our_name[:30]:30s} {len(rows):4d} players, top {top}")
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, "club_stats.json"), "w"), separators=(",",":"))
    print(f"\npublished {len(out)} clubs, skipped {len(skipped)}")
