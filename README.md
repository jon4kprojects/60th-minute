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

## Architecture: offline-first with versioned data

Gameplay never depends on a connection. The device holds a football dataset and
plays entirely from it. When there *is* a connection the app fetches only a tiny
`version.json`, and downloads a new dataset solely when the published version
differs from the one installed. The downloaded copy lives in the Cache API and
supersedes the bundled one, so **football data ships independently of the app** —
no new build required to correct a stat or widen coverage.

    ingest (extract -> patch -> transform)   one-off, run by hand
      -> dataset.json + version.json          published as static files
        -> app checks version.json when online
          -> downloads only if the version differs
            -> stores locally, applies on next launch

Failure is always silent and safe: offline, DNS failure, 404 or an empty
payload all leave the device on the copy it already has. A new dataset is
applied on the next launch rather than swapped out mid-round.

**What is deliberately not built yet: a backend and delta updates.** Both are
the right answer at scale, and neither earns its place here:

- Every mode is historical — 501, Played for Both, Career Path, Who Am I?,
  Top 10. A transfer today changes none of them. The data changes when the
  dataset is regenerated, which is a release, not a feed.
- The whole dataset is ~500 KB gzipped, and ~2 MB even with full club rosters:
  under two seconds on 4G. A delta engine would save that occasionally, at the
  cost of a diff format, a migration path and a server.

The client contract (`version.json` -> dataset) does not change when a backend
is added, so that work is additive rather than a rewrite. Add it when: data
starts changing daily (live or current-season modes), the payload passes
~20 MB, or upstream API calls need centralising away from devices.

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

### Verified club figures

Club appearance and goal figures come from Wikipedia club player lists via
`ingest/clubstats.py`, because they publish ONE definition - total competitive
appearances - where Wikidata mixes league and all-competition figures per
player. Measured against Wikidata across 286 overlapping players, ours came out
at a ratio of 0.69 (quartiles 0.66-0.73): a definitional gap, not noise. But
some were simply wrong - Drogba read 28 Chelsea appearances against a real 381.

`ingest/verify_clubs.py` is the gate (all 19 attempted clubs now pass). Each club's parse must reproduce its known
all-time record holder and figure within 2% or the club is withheld, so
Football 501 only offers clubs whose numbers we can defend. Parser fixes that got every club through: pages label Starts/Subs/Total
identically ("appearances" x3 on Manchester United), so the apps column is
chosen by largest column total rather than first match - Giggs read 802 starts
instead of 963 appearances. Grouped two-row headers are flattened via colspan.

### Club membership vs career-path display

These are different questions and must not share a filter. `clubs` is filtered
to spells of 15+ appearances so career paths stay readable; `allClubs` holds
every club a player turned out for. Filtering the membership fact made the app
deny that Demba Ba (12 games) and Javier Mascherano (5) ever played for West
Ham. Membership checks read `allClubs`; Career Path reads `clubs`.

`clubTotals` carries a per-club figure for every club, seeded from Wikidata and
overwritten by verified figures where they exist, so a short spell still scores
rather than returning nothing.

Known gap: club rosters come from Wikipedia and are far larger than our
Wikidata-derived player set, so a club's record holder may not be nameable.
Ron Harris made 795 for Chelsea and is absent from our players.

### An older caveat on appearance figures

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

## Played for Both

Pick 2-5 sides, at random or by hand, and name everyone who turned out for
**at least two of them**. Club and country both work as sides, so
`NETHERLANDS × AC MILAN` gives van Basten, Gullit, Rijkaard and Seedorf.

"At least two" rather than "all of them" is not a softening. A player who
turned out for four *specific* top clubs barely exists: zero random 4-club
combinations in 60,000 draws shared a single player, and 3 clubs worked 0.3%
of the time. At two sides the rule is identical to "played for both", and it
is what lets the mode reach five. Hit rates on the working rule: 3 clubs 71%,
4 clubs 56%, 5 clubs 18%.

The count is hidden by default and offered as a clue ("how many are there?"),
which turns the opening from "clear the board" into "is there anyone left?".

**The count is our count, not football's.** That is the one thing that could
lose trust in this mode, so feedback is honest about which kind of miss it was:

| Guess | Response | Costs a life |
|---|---|---|
| On the board | fills a slot | — |
| Already named | says so | no |
| Played for one side | names which side, and which they missed | yes |
| Played for neither | says so | yes |
| Not in our dataset | "no player by that name found" | **no** |

A name we do not hold is a gap in our data, not a bad guess, so it never costs
a life. Club prominence is measured by how many well-known players a club has,
not the squad average — averaging punishes big clubs for having deep squads.

### Why there is no league / all-competitions choice

It was built, then removed: of the 19 verified clubs, **zero** publish a usable
league breakdown. Most English club lists give Starts/Subs/Total for all
competitions and no league column at all; only West Ham's and Leicester's pages
split it out, and West Ham only for 39 players of 188. A permanently disabled
control is worse than none, so the app states the scope plainly instead.

`SCOPES` and `statKey()` remain in `football501.js` because they cost nothing
and are ready the day a source with league figures arrives. The UI should not
advertise a choice the data cannot honour.

## Guarding against lost facts

The bug that hid Demba Ba's West Ham spell was not a wrong number, it was a
missing fact, and the existing checks could not see it: they looked for clubs
we wrongly claimed and never for clubs we had silently lost.

Two root causes, both now fixed at the source:

1. **A display filter had leaked into the fact layer.** `clubs` is filtered to
   spells of 15+ appearances so career paths stay readable; `allClubs` is
   unfiltered and is what every membership check reads. 10,660 player-club
   links were hidden by the old shared filter, across 73% of players -
   Salah at Chelsea, Pique at Manchester United, Eto'o at Everton.
2. **A missing statistic was read as a zero.** De Bruyne's Manchester City
   spell has no appearance figure upstream, so it was dropped from his career
   path entirely. Absence of a statistic is not absence of a spell; only a
   spell we can SEE is small gets filtered now.

`ingest/test_membership.mjs` pins both, and asserts in the direction the old
checks missed:

- every displayed club is also a known club (a filter cannot leak back)
- no published player has empty membership
- a fixture list of real short spells must resolve, through the club index the
  games actually query, not just the player record
- a spell with no appearance figure still reaches the career path

`./run-tests.sh` runs every suite; run it after any ingestion change.

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
