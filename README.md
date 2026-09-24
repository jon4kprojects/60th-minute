# Footy — football quiz prototype

A dynamically-generated football quiz. Questions are built from structured
player data at runtime, not written by hand. Works fully offline once installed.

## Playing offline

1. Open the deployed URL on your phone **while on wifi**.
2. Wait for the **"Offline ready"** badge on the home screen.
3. **Add to Home Screen** (iOS: Share → Add to Home Screen. Android: menu → Install app).
4. Test it: turn on airplane mode and open it from the home-screen icon.

Adding to the home screen matters. iOS evicts a website's stored data after
7 days of no interaction, but home-screen-installed apps are exempt — a
bookmark alone can lose its cache while you're away.

## Data

Everything comes from **Wikidata** (CC0, public domain). No API keys, no paid
feeds, no subscription, no backend. The dataset is a single JSON file bundled
with the app, so there is nothing to run and nothing to pay for.

Rebuild it with:

```
python3 ingest/extract.py     # bulk select the most famous players via QLever
python3 ingest/patch.py       # fill thin records from live Wikidata
python3 ingest/transform.py   # normalise, filter, emit dataset.json
cp ingest/out/dataset.json app/data/dataset.json
node ingest/test_engine.mjs   # verify questions are well-formed
```

`TOP_N=4000 python3 ingest/extract.py` widens the player pool.

### Why these filters exist

Every rule in `transform.py` is there because live data broke without it:

- **Career-appearance floor** — Albert Camus, Niels Bohr and Sean Connery are
  all tagged as footballers on Wikidata. They genuinely played a bit. The floor
  removes people famous for something else.
- **Club-type whitelist** — keeps out national teams, the Football League XI,
  and Geoff Hurst's first-class cricket career.
- **Year sanity range** — Wikidata has malformed dates (Roberto Carlos had a
  club spell starting in year 1, which scrambled his career order).
- **Tiny-spell removal** — loan moves and twilight cameos make Career Path
  unguessable.
- **Wikipedia titles as display names** — Wikidata labels give full legal names,
  and some players (Mbappé) have no English label at all.

## Question generation

`app/js/engine/` holds one file per mode, each a pure function of
`(dataset, seededRandom) -> question | null`. Returning `null` means the
generator could not build a question it could stand behind, and the caller
simply tries again.

Trust rules enforced in code:

- Career Path rejects any club sequence shared by more than one player.
- Higher or Lower refuses pairs closer than 25 apps/goals *and* 18%, because
  the source disagrees with official records at the margins.
- Who Am I? reads every clue from a field. Nothing is composed or inferred.
- Decoys are matched on fame tier and era, so questions test football
  knowledge rather than name recognition.

Adding a mode: write `app/js/engine/yourMode.js` exporting `eligible(db)` and
`generate(db, rnd)`, then add one line to `app/js/engine/index.js`.

## Daily Challenge

Seeded from the date string, so everyone gets the same 10 questions with no
server involved. Works offline.

## Admin

`app/quality.html` — dataset coverage, completeness and ambiguity risks.

## Licence

Player data from Wikidata, CC0. Code MIT.
