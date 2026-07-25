# NFL Futures Parlay Finder

A hosted tool for finding **positive-expected-value NFL futures parlays**. It
combines season-long bets (Super Bowl, conference, division, make-playoffs, and
win totals) into parlays and ranks them by real, **correlation-aware**
probability — not the naive independence assumption most parlay tools use.

Built to research parlays you then place manually on FanDuel (no sportsbook has
a public bet-placement API).

## Why it's different

The core is a **Monte Carlo season simulation**. It plays out the entire NFL
season plus a reseeded 7-seed playoff bracket ~20,000 times, then reads each
parlay's true win probability directly from the simulations. That means:

- **Correlation is handled for free.** "Bills win AFC East" + "Bills make
  playoffs" isn't treated as independent — the sim knows a division winner
  always makes the playoffs. Nested bets (Super Bowl ⊂ conference ⊂ playoffs)
  and mutually-exclusive bets (two teams winning the same division) are priced
  correctly, and impossible combos are auto-removed.
- **Value = model vs. market.** Each leg's model probability (from the sim) is
  compared to the book's vig-removed implied probability. A parlay's EV uses the
  joint simulated probability against the combined price.

## Search controls

- Number of legs (min–max)
- Which markets to combine
- Rank by: best value (EV ÷ risk), highest EV, most likely, or biggest payout
- Minimum win probability and minimum EV floors
- Payout window (American odds)
- Allow or block correlated same-team legs
- Include / exclude specific teams
- Bankroll + fractional-Kelly stake sizing
- Trust filter: drop legs where the model diverges too far from market consensus
- "FanDuel best-priced only" — keep parlays where FanDuel beats every book on every leg

## The four tabs

1. **Find Parlays** — the search builder above, plus:
   - *Injury / news adjustments*: nudge any team's power rating (star QB out ≈ −80
     to −120 Elo); market prices stay fixed so your adjustment surfaces as edge.
   - *Season so far*: enter finished games and the sim replays only the remaining
     schedule — live re-simulation for open tickets and mid-season hunting.
   - *Saved searches / alerts*: save a search with its EV threshold, re-run all
     with one click; a search lights up when its top result clears the bar.
2. **Line Shop** — every leg across FanDuel, DraftKings, BetMGM, Caesars, and
   ESPN BET, with model vs consensus probabilities and per-leg EV. Green = best
   price; when FanDuel is green, their number is soft.
3. **Portfolio** — all your tickets evaluated as one book against the *same*
   simulated seasons, so correlation between tickets is captured: expected P&L,
   P(profit), P(lose everything), outcome percentiles, and team-exposure
   concentration bars. Tickets persist in your browser.
4. **Model Trust** — engine invariants (probabilities that must sum to 1/7),
   model-vs-market RMSE by market, and a calibration backtest (Brier score,
   predicted-vs-actual by bucket). Ships with clearly-labeled synthetic history;
   feed real bet logs via `src/lib/data/history.ts`.

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Data

Ships with **seeded sample odds and model ratings** so it runs with no API key.
The value shown is driven by injected model-vs-market disagreement — it
demonstrates the mechanics, it is not real edge.

To use **live odds**, copy `.env.example` to `.env.local`, add a key from
[the-odds-api.com](https://the-odds-api.com), set `ODDS_SOURCE=live`, and
implement `fetchLiveOddsMap()` in `src/lib/data/oddsSource.ts`. Team ratings
live in `src/lib/data/teams.ts` — tune those to change the model's opinion.

## Architecture

```
src/lib/engine/
  simulate.ts   Monte Carlo season + playoffs  → per-sim outcomes
  schedule.ts   NFL scheduling-formula generator (272 games)
  markets.ts    turn sim outcomes into betting legs + model probabilities
  bitset.ts     fast joint-probability math over simulations
  parlay.ts     evaluate a parlay (joint prob, EV, Kelly, correlation)
  search.ts     generate + rank combinations under constraints
  odds.ts       American/decimal/implied conversions, de-vig, Kelly
src/app/api/    search + meta routes (simulation is cached per process)
src/app/page.tsx  the search builder + results UI
```

## Architecture additions

```
src/lib/engine/
  diagnostics.ts  engine invariants + model-vs-market agreement
  backtest.ts     calibration metrics (Brier, log-loss, reliability bins)
  portfolio.ts    joint P&L distribution across tickets via shared sims
src/app/api/
  legs/           full leg board (line shopping, ticket builder)
  portfolio/      portfolio evaluation
  diagnostics/    model trust report
```

The engine caches one base simulation per process; injury adjustments and
decided games each produce a cached variant keyed by their inputs, evaluated
against the SAME fixed market odds — so only your model moves, never the market.

---

**Not financial advice.** Positive EV ≠ likely to win; parlays are
high-variance. 21+. If gambling stops being fun, call 1-800-GAMBLER.
