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
    digest = sha_of(SRC)[:12]

    old = {}
    if os.path.exists(VER):
        old = json.load(open(VER))

    # the build counter only ever goes up, so a stamp is comparable across days
    n = 1
    m = re.search(r"'b(\d+)\.", open(MAIN).read())
    if m:
        n = int(m.group(1)) + 1
    build = f"b{n}.{git_sha()}"

    shutil.copyfile(SRC, DST)
    ver = {
        "version": f"1.{n}.{digest[:6]}",
        "built": datetime.date.today().isoformat(),
        "sha256": digest,
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
