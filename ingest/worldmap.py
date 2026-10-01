#!/usr/bin/env python3
"""
Build the clickable world map for Country Conundrum.

Shapes come from Natural Earth 110m ADMIN-0 MAP UNITS, which is public domain.
Map units rather than countries because football's nations are not the world's:
England, Scotland, Wales and Northern Ireland are four of the biggest footballing
countries there are and a political map draws them as one.

Output is paths keyed by OUR nationality names, so the app never has to map a
name at runtime. Projection is equirectangular - the arithmetic is trivial, and
for picking a country out of a map that matters more than area being honest.
Latitude is cropped at 84N/58S: Antarctica is not a footballing nation and
leaving it in wastes a sixth of a phone screen.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/units.geojson"

W, H = 1000, 460
LAT_TOP, LAT_BOT = 84.0, -58.0

# Natural Earth's spelling on the left, football's on the right.
ALIAS = {
    "United States of America": "United States",
    "Ireland": "Republic of Ireland",
    "N. Ireland": "Northern Ireland",
    "Bosnia and Herz.": "Bosnia and Herzegovina",
    "Côte d'Ivoire": "Ivory Coast",
    "Dem. Rep. Congo": "DR Congo",
    "Central African Rep.": "Central African Republic",
    "Dominican Rep.": "Dominican Republic",
    "Eq. Guinea": "Equatorial Guinea",
    "Gambia": "The Gambia",
    "United Arab Emirates": "Emirates",
    "Solomon Is.": "Solomon Islands",
    "S. Sudan": "South Sudan",
    "Taiwan": "Chinese Taipei",
    "eSwatini": "Eswatini",
}

# Shapes with no football side of their own: either uninhabited, or territories
# whose players are capped elsewhere. Drawn, but never an answer.
INERT = {
    "Antarctica", "Fr. S. Antarctic Lands", "Greenland", "Svalbard Is.",
    "Falkland Is.", "W. Sahara", "Somaliland", "N. Cyprus", "West Bank",
    "Bougainville", "French Guiana",
}


def project(lon, lat):
    x = (lon + 180.0) / 360.0 * W
    y = (LAT_TOP - lat) / (LAT_TOP - LAT_BOT) * H
    return x, y


def ring_to_path(ring):
    """One closed ring, with points that round to the same place dropped."""
    out, last = [], None
    for lon, lat in ring:
        x, y = project(lon, lat)
        pt = (round(x, 1), round(y, 1))
        if pt == last:
            continue
        out.append(pt)
        last = pt
    if len(out) < 3:
        return ""
    d = f"M{out[0][0]} {out[0][1]}"
    for x, y in out[1:]:
        d += f"L{x} {y}"
    return d + "Z"


def main():
    gj = json.load(open(SRC))
    paths, inert = {}, []
    for f in gj["features"]:
        name = f["properties"].get("NAME")
        if not name:
            continue
        geom = f.get("geometry") or {}
        polys = (geom.get("coordinates") or []) if geom.get("type") == "MultiPolygon" \
            else ([geom.get("coordinates")] if geom.get("type") == "Polygon" else [])
        d = ""
        for poly in polys:
            for ring in poly:
                # clip hard at the crop, so Antarctic tails do not stretch the box
                if all(lat < LAT_BOT or lat > LAT_TOP for _, lat in ring):
                    continue
                d += ring_to_path([(lon, max(LAT_BOT, min(LAT_TOP, lat))) for lon, lat in ring])
        if not d:
            continue
        if name in INERT:
            inert.append(d)
        else:
            paths[ALIAS.get(name, name)] = d

    out = {"viewBox": f"0 0 {W} {H}", "countries": paths, "inert": inert}
    path = os.path.join(OUT, "world.json")
    json.dump(out, open(path, "w"), separators=(",", ":"))
    print(f"world map: {len(paths):,} nameable shapes, {len(inert)} inert")
    print(f"  {os.path.getsize(path)/1024:.0f} KB -> {path}")

    db = json.load(open(os.path.join(OUT, "dataset.json")))
    ours = {p["nationality"] for p in db["players"] if p.get("nationality")}
    placed = ours & set(paths)
    print(f"  football nations with a shape: {len(placed)} of {len(ours)}")
    missing = sorted(ours - set(paths))
    print(f"  without one ({len(missing)}): {', '.join(missing[:18])}")


if __name__ == "__main__":
    main()
