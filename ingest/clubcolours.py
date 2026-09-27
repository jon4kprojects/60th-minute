#!/usr/bin/env python3
"""
Club colours, for the tiles that stand in for crests.

Badges are trademarks, so the app never ships one. Colours are not: "Arsenal
play in red and white" is a fact, and a red tile with white lettering says the
same thing to a fan without borrowing anyone's mark.

Wikidata holds club colours as NAMED colours (P6364) whose own hex values are
the crude primaries - Celtic's green comes back as 00FF00, which is a highlighter
pen. The names are right, so the names are what we use, mapped to a palette that
looks like football rather than a 1987 colour picker.
"""
import json, os, subprocess, sys

EP = "https://qlever.dev/api/wikidata"
OUT = os.path.join(os.path.dirname(__file__), "out")

QUERY = """
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?clubName ?colName WHERE {
  ?club wdt:P31/wdt:P279* wd:Q476028 .
  ?club rdfs:label ?clubName . FILTER(LANG(?clubName)="en")
  ?club wdt:P6364 ?col .
  ?col rdfs:label ?colName . FILTER(LANG(?colName)="en")
}
"""

# Football shades, not primaries. A tile has to read at 74px on a phone, so
# every one of these is dark enough to carry white lettering except the pale
# few, which are flagged by luminance below rather than by hand.
PALETTE = {
    "white": "#f2f4f7", "black": "#1b1e24", "grey": "#6b7280", "gray": "#6b7280",
    "red": "#c8102e", "crimson": "#b01030", "maroon": "#6d1028", "wine": "#6d1028",
    "bordeaux": "#5c1226", "claret": "#6d1028",
    "blue": "#1f4ea1", "navy blue": "#16264a", "navy": "#16264a",
    "royal blue": "#1546b0", "sky blue": "#5fa8dc", "azure": "#3b7fc4",
    "cyan": "#2aa9b8", "light blue": "#5fa8dc",
    "green": "#0f7a43", "dark green": "#0b5c33", "light green": "#3aa864",
    "yellow": "#f2c230", "gold": "#d4a72c", "amber": "#e0a51c",
    "orange": "#e2661f", "purple": "#5b2a86", "violet": "#5b2a86",
    "pink": "#e06c9f", "brown": "#6b4423", "silver": "#b8bcc4",
    "turquoise": "#1f9e9e", "beige": "#d9cbb3",
}

# The clubs that actually appear as grid categories, checked by eye against the
# kit rather than trusted to Wikidata. Its colour statements are thin where it
# matters most - Bayern, Milan and Ajax have none at all, and Real Madrid lists
# "white" and "purple", so the luminance rule made Real Madrid purple. Sixty-odd
# clubs carry the whole visible surface of the game, so they are worth typing out.
OVERRIDES = {
    "FC Barcelona": ("#a50044", "#edbb00"),
    "Real Madrid Club de Fútbol": ("#f2f4f7", "#1b3c87"),
    "Atlético Madrid": ("#cb3524", "#ffffff"),
    "Sevilla FC": ("#d81920", "#ffffff"),
    "Valencia CF": ("#f2f4f7", "#e36b1f"),
    "Villarreal CF": ("#f2c230", "#16264a"),
    "RCD Espanyol de Barcelona": ("#0072ce", "#ffffff"),
    "Real Zaragoza": ("#1f4ea1", "#ffffff"),
    "Manchester United F.C.": ("#da291c", "#ffffff"),
    "Manchester City F.C.": ("#6cabdd", "#16264a"),
    "Liverpool F.C.": ("#c8102e", "#ffffff"),
    "Arsenal F.C.": ("#ef0107", "#ffffff"),
    "Chelsea F.C.": ("#034694", "#ffffff"),
    "Tottenham Hotspur F.C.": ("#132257", "#ffffff"),
    "Everton F.C.": ("#003399", "#ffffff"),
    "West Ham United F.C.": ("#7a263a", "#1bb1e7"),
    "Aston Villa F.C.": ("#670e36", "#95bfe5"),
    "Leicester City F.C.": ("#003090", "#ffffff"),
    "Southampton F.C.": ("#d71920", "#ffffff"),
    "Fulham F.C.": ("#f2f4f7", "#1b1e24"),
    "Celtic F.C.": ("#018749", "#ffffff"),
    "Juventus FC": ("#1b1e24", "#ffffff"),
    "AC Milan": ("#c40c14", "#ffffff"),
    "Inter Milan": ("#0b3a78", "#ffffff"),
    "AS Roma": ("#8e1f2f", "#f0bc42"),
    "SS Lazio": ("#87d8f7", "#16264a"),
    "SSC Napoli": ("#12a0d7", "#ffffff"),
    "ACF Fiorentina": ("#6b2c91", "#ffffff"),
    "Udinese Calcio": ("#1b1e24", "#ffffff"),
    "Genoa CFC": ("#8b1a1a", "#1b3b6f"),
    "U.C. Sampdoria": ("#1b4ca0", "#ffffff"),
    "Parma Calcio 1913": ("#f2c230", "#1f4ea1"),
    "FC Bayern Munich": ("#dc052d", "#ffffff"),
    "Borussia Dortmund": ("#fde100", "#1b1e24"),
    "Schalke 04": ("#004d9d", "#ffffff"),
    "Hamburger SV": ("#1b3b8b", "#ffffff"),
    "VfB Stuttgart": ("#d40f1e", "#ffffff"),
    "Bayer 04 Leverkusen": ("#e32221", "#1b1e24"),
    "VfL Wolfsburg": ("#65b32e", "#1b1e24"),
    "Paris Saint-Germain FC": ("#04224c", "#ffffff"),
    "Olympique de Marseille": ("#009ada", "#ffffff"),
    "Olympique Lyonnais": ("#1b3c87", "#ffffff"),
    "AS Monaco FC": ("#ce1126", "#ffffff"),
    "Lille OSC": ("#e01e13", "#ffffff"),
    "OGC Nice": ("#1b1e24", "#c8102e"),
    "AFC Ajax": ("#d2122e", "#ffffff"),
    "PSV Eindhoven": ("#e4002b", "#ffffff"),
    "S.L. Benfica": ("#e00000", "#ffffff"),
    "FC Porto": ("#00428c", "#ffffff"),
    "Sporting CP": ("#008057", "#ffffff"),
    "Galatasaray S.K.": ("#a90432", "#fbb03b"),
    "Fenerbahçe Istanbul": ("#1b3b6f", "#ffed00"),
    "FC Zenit Saint Petersburg": ("#0b4ea2", "#87ceeb"),
    "Clube de Regatas do Flamengo": ("#c52613", "#1b1e24"),
    "Fluminense F.C.": ("#870a2f", "#ffffff"),
    "S.C. Corinthians Paulista": ("#1b1e24", "#ffffff"),
    "Clube Atlético Mineiro": ("#1b1e24", "#ffffff"),
    "São Paulo FC": ("#fe0000", "#ffffff"),
    "Santos F.C.": ("#f2f4f7", "#1b1e24"),
    "Club Atlético River Plate": ("#f2f4f7", "#d6002a"),
    "LA Galaxy": ("#00245d", "#ffd200"),
    "Vissel Kobe": ("#8c1d40", "#ffffff"),
}

# Some entries are compounds ("yellow-black"); split and take both in order.
def expand(name):
    n = name.lower().strip()
    if n in PALETTE:
        return [n]
    parts = [p.strip() for p in n.replace("/", "-").split("-")]
    return [p for p in parts if p in PALETTE]


def luminance(hexstr):
    r, g, b = (int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def sparql():
    r = subprocess.run(
        ["curl", "-sSL", "-X", "POST", EP,
         "-H", "Accept: application/sparql-results+json",
         "-H", "User-Agent: 60thMinute/0.1 (one-off dataset build)",
         "--retry", "6", "--retry-delay", "3", "--retry-all-errors",
         "--max-time", "600", "--data-urlencode", "query=" + QUERY],
        capture_output=True, text=True)
    try:
        return json.loads(r.stdout)["results"]["bindings"]
    except Exception:
        raise SystemExit("club colours query failed: " + (r.stdout or r.stderr)[:300])


def main():
    rows = sparql()
    order = {}
    for r in rows:
        club = r["clubName"]["value"]
        for name in expand(r["colName"]["value"]):
            order.setdefault(club, [])
            if name not in order[club]:
                order[club].append(name)

    out = {k: list(v) for k, v in OVERRIDES.items()}
    for club, names in order.items():
        if club in out:
            continue
        hexes = [PALETTE[n] for n in names]
        # The background is the first colour dark enough to carry white text.
        # Falling back to the first colour keeps all-pale clubs (white/yellow)
        # looking like themselves, with dark lettering instead.
        bg = next((h for h in hexes if luminance(h) < 0.45), hexes[0])
        fg = "#ffffff" if luminance(bg) < 0.45 else "#1b1e24"
        # A second colour that reads against the background earns the lettering,
        # which is what makes Norwich yellow-on-green rather than white-on-green.
        for h in hexes:
            if h == bg:
                continue
            if abs(luminance(h) - luminance(bg)) > 0.38:
                fg = h
                break
        out[club] = [bg, fg]

    path = os.path.join(OUT, "club_colours.json")
    json.dump(out, open(path, "w"), sort_keys=True)
    print(f"club colours: {len(out):,} clubs -> {path}")
    for n in ["Arsenal F.C.", "Liverpool F.C.", "Celtic F.C.", "FC Barcelona",
              "Norwich City F.C.", "Borussia Dortmund", "Juventus FC"]:
        print(f"   {n:24s} {out.get(n)}")


if __name__ == "__main__":
    main()
