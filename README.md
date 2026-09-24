# 60th Minute — football quiz prototype

A dynamically-generated football quiz. Brand assets live in `app/brand/`
(open `app/brand/index.html` for the sheet). Questions are built from structured
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
- **Appearance plausibility cap** — Maldini is recorded with 1,987 appearances
  for Milan (someone typed a year into the field). He is kept as a player but
  his stats are withheld rather than shown wrong.
- **One-club players retained** — an earlier `MIN_CLUBS >= 2` rule silently
  removed Giggs, Scholes and Totti, who are exactly the names Football 501
  needs. Career Path filters for 3+ clubs at generation time instead.

### A caveat on appearance figures

Wikidata mixes conventions: Giggs is recorded at 672 for Manchester United (all
competitions) while Gerrard is at 504 for Liverpool (league only). The app
therefore says "appearances" rather than "league appearances". Figures are
right often enough to play with, but they are not an official record.

## Football 501

Darts scoring with footballers, pass-and-play on one device (2-4 players).
Everyone starts on 501, a club is chosen, and you take turns naming players who
turned out for them. Their appearances (or goals) for that club come off your
total. Over 180 scores nothing, mirroring the maximum visit in darts, so the
skill is finding a usable number rather than the most famous name. Checkout
window is 0 to -10; going past it busts the turn.

Typing gives suggestions after two characters, matched against **every player
in the dataset and never filtered to the chosen club**. Filtering would print
the team sheet on screen and there would be no game left; matching globally
only helps you spell a name you had already thought of.

Ranking in `app/js/names.js` puts a surname above a whole-name prefix, because
a single typed token is nearly always a surname - "gigi riva" also starts with
"gig" and used to be offered above Ryan Giggs. Typo tolerance is a fallback
tier only: applied eagerly it suggested Neto for "nedv".

On submit, resolution is separate from suggestion and *does* use the club as
context, giving roster members a bonus. Without it "trezeguet" resolved to the
Egyptian winger rather than David Trezeguet, who scored 138 for Juventus. This
is invisible to the player - it only picks the sensible reading.

Scoring defaults to **goals**. With appearances roughly a third of every big
squad is over the 180 cap and scores nothing, which stalls the round; on goals
about 99% of players with data fall under it.

365 clubs have enough depth to play. Manchester United holds 154 players, 98 of
whom score under 180.

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
