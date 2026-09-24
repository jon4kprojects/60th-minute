#!/usr/bin/env python3
"""
League-only appearances and goals, from Wikipedia player infoboxes.

Club player lists publish all-competition totals and almost never break out
league figures - of 19 verified clubs, zero did. But every player's own page
carries an infobox whose club rows are league appearances by convention;
Wikipedia even annotates it ("League Appearances and goals ONLY").

Fetched 50 pages per request, so the whole dataset costs ~114 calls.
"""
import json, os, re, sys, time, unicodedata, urllib.request, urllib.parse

HERE = os.path.dirname(__file__); OUT = os.path.join(HERE, "out")
UA = "60thMinute/0.1 (one-off dataset build; football quiz prototype)"
BATCH = 50

_last = [0.0]
def api(params, tries=5):
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
            time.sleep(5 * (attempt + 1))
        except Exception:
            if attempt == tries - 1: raise
            time.sleep(3)

def norm(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9 ]', '', s.lower()).strip()

# youth, reserve and loan-marker rows we do not want as club figures
SKIP = re.compile(r"\b(youth|academy|u-?\d\d|reserves?|\bB\b|II)\b", re.I)

def parse_infobox(txt):
    """[(club_page_title, league_apps, league_goals)] from the club career rows."""
    i = txt.find("{{Infobox football biography")
    if i < 0: return []
    seg = txt[i:i + 6000]
    rows = {}
    for m in re.finditer(r"\|\s*(clubs|caps|goals)(\d+)\s*=([^\n]*)", seg):
        field, idx, val = m.group(1), int(m.group(2)), m.group(3)
        val = re.sub(r"<!--.*?-->", "", val).strip()
        rows.setdefault(idx, {})[field] = val
    out = []
    for idx in sorted(rows):
        r = rows[idx]
        club = r.get("clubs", "")
        if not club: continue
        # [[Arsenal F.C.|Arsenal]] or → [[Arsenal F.C.|Arsenal]] (loan)
        link = re.search(r"\[\[([^\]|]+)", club)
        if not link: continue
        title = link.group(1).strip()
        label = club.split("|")[-1].replace("]]", "")
        if SKIP.search(label) or SKIP.search(title): continue
        def num(k):
            v = r.get(k, "")
            mm = re.search(r"\d+", v.replace(",", ""))
            return int(mm.group()) if mm else None
        a, g = num("caps"), num("goals")
        if a is None: continue
        out.append((title, a, g if g is not None else 0))
    return out

if __name__ == "__main__":
    titles_raw = json.load(open(os.path.join(OUT, "raw_titles.json")))
    V = lambda b, k: b.get(k, {}).get("value")
    Q = lambda u: u.rsplit("/", 1)[-1]
    qid_title = {Q(V(b, "p")): V(b, "title") for b in titles_raw if V(b, "title")}

    data = json.load(open(os.path.join(OUT, "dataset.json")))
    wanted = {p["id"]: qid_title.get(p["id"]) for p in data["players"]}
    wanted = {k: v for k, v in wanted.items() if v}
    print(f"fetching infoboxes for {len(wanted):,} players, {BATCH} per request")

    by_title = {}
    items = list(wanted.items())
    for i in range(0, len(items), BATCH):
        chunk = items[i:i + BATCH]
        d = api({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                 "titles": "|".join(t for _, t in chunk), "format": "json", "formatversion": "2"})
        for pg in d.get("query", {}).get("pages", []):
            if pg.get("missing") or "revisions" not in pg: continue
            by_title[pg["title"]] = parse_infobox(pg["revisions"][0]["slots"]["main"]["content"])
        if (i // BATCH) % 10 == 0:
            print(f"  {i + len(chunk):5d}/{len(items)}"); sys.stdout.flush()

    out = {}
    for qid, title in wanted.items():
        rows = by_title.get(title)
        if rows: out[qid] = [{"club": c, "apps": a, "goals": g} for c, a, g in rows]
    json.dump(out, open(os.path.join(OUT, "league_stats.json"), "w"), separators=(",", ":"))
    print(f"\nplayers with league figures: {len(out):,}")
    print(f"club rows captured:          {sum(len(v) for v in out.values()):,}")
