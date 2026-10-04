#!/usr/bin/env python3
"""
Copy the built dataset into the app and stamp every version marker at once.

Three markers have to move together or the app lies about itself: the dataset
version the updater compares, the BUILD shown on the home screen, and the
service worker's cache name. Bumping them by hand went wrong repeatedly - the
cache name sat on one build while the code had moved three times, so phones
kept serving code that had already been fixed. One script now does all three,
and it refuses to run if the dataset has not actually changed shape.
"""
import hashlib, json, os, re, shutil, subprocess, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "ingest", "out", "dataset.json")
DST = os.path.join(ROOT, "app", "data", "dataset.json")
VER = os.path.join(ROOT, "app", "data", "version.json")
MAIN = os.path.join(ROOT, "app", "js", "main.js")
SW = os.path.join(ROOT, "app", "sw.js")


def sha_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git_sha():
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "nogit"


def main():
    db = json.load(open(SRC))
    players = db["players"]
    # transform.py stamps a version before the merge steps have run, so its
    # number describes a dataset that no longer exists by the time we ship. The
    # version has to be computed here, from the finished file, and written into
    # both places that carry it - they disagreed otherwise, and the app shows
    # one while the updater compares the other.
    digest = sha_of(SRC)[:12]

    old = {}
    if os.path.exists(VER):
        old = json.load(open(VER))

    # the build counter only ever goes up, so a code stamp is comparable across
    # days. It is deliberately not part of the data version.
    n = 1
    m = re.search(r"'b(\d+)\.", open(MAIN).read())
    if m:
        n = int(m.group(1)) + 1
    build = f"b{n}.{git_sha()}"

    # Derived from the data alone, never from the build counter. Every phone
    # re-downloads the whole 7MB when this string changes, so a code-only
    # release must leave it exactly where it was.
    # Club names are interned for the journey and put back on arrival. Every
    # club name appears once in a shared table and the records hold an index,
    # which takes 3MB off the wire - gzip's window is far too small to spot that
    # "Clube de Regatas do Flamengo" has already gone past three hundred times.
    names = {}
    def cid(n):
        if n not in names:
            names[n] = len(names)
        return names[n]
    for p in players:
        p["allClubs"] = [cid(c) for c in (p.get("allClubs") or [])]
        for c in (p.get("clubs") or []):
            c["club"] = cid(c["club"])
        if p.get("clubTotals"):
            p["clubTotals"] = {str(cid(k)): v for k, v in p["clubTotals"].items()}
    table = [None] * len(names)
    for n, i in names.items():
        table[i] = n
    db["clubNames"] = table

    version = f"1.{digest[:8]}"
    # the map ships beside the dataset and is versioned with it
    world = os.path.join(ROOT, "ingest", "out", "world.json")
    if os.path.exists(world):
        shutil.copyfile(world, os.path.join(ROOT, "app", "data", "world.json"))
    db["version"] = version
    with open(DST, "w") as f:
        json.dump(db, f, separators=(",", ":"))
    ver = {
        "version": version,
        "built": datetime.date.today().isoformat(),
        "sha256": sha_of(DST)[:12],
        "players": len(players),
        "bytes": os.path.getsize(DST),
        "verifiedClubs": old.get("verifiedClubs", 0),
        "playableClubs": old.get("playableClubs", 0),
        "topFiveClubs": old.get("topFiveClubs", 0),
    }
    json.dump(ver, open(VER, "w"), indent=2)

    for path, pattern in ((MAIN, r"const BUILD = '[^']*'"), (SW, r"const CACHE = '[^']*'")):
        s = open(path).read()
        rep = f"const BUILD = '{build}'" if path == MAIN else f"const CACHE = 'm60-{build}'"
        s2, k = re.subn(pattern, rep, s, count=1)
        if not k:
            raise SystemExit(f"could not find the stamp in {path} - publish aborted")
        open(path, "w").write(s2)

    with_countries = sum(1 for p in players if p.get("countries"))
    print(f"published {len(players)} players  ({with_countries} with countries)")
    print(f"  version {ver['version']}   was {old.get('version', 'none')}")
    print(f"  build   {build}")
    print(f"  bytes   {ver['bytes']:,}")


if __name__ == "__main__":
    main()
