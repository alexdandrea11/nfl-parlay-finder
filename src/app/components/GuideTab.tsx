"use client";

import { Card, SectionTitle } from "./ui";

// Plain-English glossary of every metric in the app, grouped by where you
// meet it. Static content — no data fetches.

interface Term {
  name: string;
  body: string;
}

const GROUPS: { title: string; intro?: string; terms: Term[] }[] = [
  {
    title: "Reading a parlay card",
    terms: [
      {
        name: "Win prob",
        body: "The chance every leg hits, read directly from 20,000 simulated seasons. This is NOT the legs multiplied together — the simulation knows when legs are connected (a division winner always makes the playoffs) or impossible together, so this number already accounts for correlation.",
      },
      {
        name: "Fair price",
        body: "The American odds at which this parlay would be exactly break-even if our win probability is right. If FanDuel quotes better (a bigger + number), the bet is +EV by our model; worse, it's -EV. Use the \"FD quotes?\" box to check a real quote instantly.",
      },
      {
        name: "EV (expected value)",
        body: "Average profit per $1 bet if you could place this bet thousands of times. +20% EV means you'd expect to profit $0.20 per $1 staked over the long run. IMPORTANT: +EV does not mean likely to win — a 10%-to-hit parlay can be hugely +EV and still lose 9 times out of 10.",
      },
      {
        name: "Kelly stake",
        body: "The bankroll fraction that maximizes long-run growth given the edge and odds, scaled by your Kelly multiplier (default 25% — \"quarter Kelly\"). Full Kelly is theoretically optimal but brutally volatile; quarter Kelly sacrifices a little growth for much smoother swings. If EV is negative, Kelly is $0: don't bet.",
      },
      {
        name: "Correlated ×",
        body: "How much the legs move together. 2.0× means the parlay is twice as likely as independent legs would suggest — the sim found they win in the same seasons. Positively correlated legs are where sportsbooks misprice parlays most, because most books price legs independently.",
      },
      {
        name: "Market says",
        body: "The street's vig-removed probability for the same parlay (each leg's consensus multiplied). When our number is higher than this AND the price is real (dot on the leg), that's the bet case in one line.",
      },
    ],
  },
  {
    title: "Leg metrics (Line Shop, Vs. Street)",
    terms: [
      {
        name: "Model probability",
        body: "Our simulation's chance the bet hits. Comes from the proprietary engine: unit-matchup game model → full-season Monte Carlo → count the seasons where it happened.",
      },
      {
        name: "Market / street probability",
        body: "What the betting market believes, after stripping the bookmaker's profit margin (the \"vig\"). We average implied probabilities across books, then normalize each market group so probabilities sum to what logic demands (32 SB probs sum to 100%, 16 playoff probs per conference sum to 700%, over+under sum to 100%).",
      },
      {
        name: "Divergence",
        body: "Model minus market, in probability points. Small divergence everywhere = the model is sane. A few big divergences = either our edge or our error — the Teams tab shows the reasoning so you can judge which.",
      },
      {
        name: "Leg EV / Edge",
        body: "Expected value of betting this single leg at FanDuel's current price using our model probability. The Line Shop sorts by this to surface single-bet value before you even build parlays.",
      },
      {
        name: "Price dots",
        body: "Green dot = live feed price (real). Amber dot = a price you typed into the FanDuel board (real). No dot = modeled sample placeholder — EV against a placeholder means NOTHING; enter the real price first.",
      },
      {
        name: "Vig / hold",
        body: "The bookmaker's built-in margin. Sum a market's implied probabilities and they exceed 100% — the excess is the book's cut. Super Bowl futures carry brutal hold (25%+); win totals are much thinner (~6%). This is why blindly betting futures loses: you must beat the vig, not just be right.",
      },
    ],
  },
  {
    title: "The engine (Teams tab)",
    terms: [
      {
        name: "EPA (expected points added)",
        body: "The standard measure of play quality: how much a play changed the team's expected points, given down, distance, and field position. A pass offense at +0.15 EPA/dropback is elite; -0.10 is awful. Our team profiles are EPA per play by unit, from three seasons of play-by-play, recency-weighted and regressed toward average for preseason uncertainty.",
      },
      {
        name: "Unit-matchup model",
        body: "Games are priced by crossing each offense with the opposing defense (pass off vs pass def, rush off vs rush def) — so a great passing attack means more against a leaky secondary than an elite one. Deliberately NOT player-vs-player \"ownage\" stats: at NFL sample sizes those are noise and make predictions worse.",
      },
      {
        name: "Power rating",
        body: "One number per team: expected margin of victory against a league-average team on a neutral field, in points. Derived from the unit profiles. Comparable to ESPN's FPI (see Vs. Street).",
      },
      {
        name: "QB rating & swaps",
        body: "Each QB's passing EPA per dropback, volume-shrunk so small samples regress to average. Swapping a starter moves 75% of the QB gap onto the team's passing offense — receivers, line, and scheme carry the rest. \"Replacement-level backup\" is the average of the actual backup tier.",
      },
      {
        name: "P(playoffs | k wins)",
        body: "The \"how many wins do they need\" chart: among simulated seasons where the team won exactly k games, the share where they made the playoffs. Already accounts for their division and conference strength, because it's read from the same seasons.",
      },
    ],
  },
  {
    title: "Trust & discipline (Find, Model Trust)",
    terms: [
      {
        name: "Market anchor",
        body: "The \"within reason\" dial. 0% = pure model conviction; 100% = pure market. The default 30% blends our probability toward the street in log-odds space before computing EV and stakes — big lone disagreements get tempered, small edges survive. The pure model number is always shown alongside so you see both.",
      },
      {
        name: "Trust filter (max divergence)",
        body: "Drops legs where the model disagrees with the street by more than X points. A blunt guardrail: huge divergence is more often model error than hidden genius. Loosen it deliberately when you have a reason (e.g. you set a QB swap the market hasn't priced).",
      },
      {
        name: "Brier score",
        body: "Average squared error of predictions vs outcomes. 0 = clairvoyant, 0.25 = coin flip. The calibration backtest computes it over logged bets — until you log real bets, that chart runs on labeled synthetic data and proves nothing.",
      },
      {
        name: "Calibration",
        body: "Whether \"20% bets\" actually hit 20% of the time. A model can rank teams well and still be badly calibrated (all its probabilities too extreme). Calibration is what EV math depends on — this is the single most important thing to verify before sizing up.",
      },
      {
        name: "Engine invariants",
        body: "Structural checks that must hold exactly: one champion, one winner per division, seven playoff teams per conference. If these fail, the simulation is broken and nothing else on the site means anything. They should always read ALL PASS.",
      },
      {
        name: "Portfolio percentiles (p5–p95)",
        body: "Your combined outcome distribution across all tickets, evaluated in the SAME simulated seasons — so it catches five parlays secretly riding one team. p5 = a bad season, p50 = median, p95 = a great one. Expect the median to be negative for a longshot-heavy book even when EV is positive; that's the shape of futures betting.",
      },
    ],
  },
];

export function GuideTab() {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <SectionTitle>How to use this thing</SectionTitle>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2">
          <li>Enter FanDuel's real prices in <b className="text-ink">Line Shop → ✎ FanDuel board</b> (weekly is plenty).</li>
          <li>Sanity-check the model in <b className="text-ink">Vs. Street</b> — agreement high, outliers explainable.</li>
          <li>Investigate outliers in <b className="text-ink">Teams</b> — set QB swaps and injury adjustments you believe in.</li>
          <li>Run <b className="text-ink">Find Parlays</b> with the anchor at ~30%; check FanDuel's actual quote with the “FD quotes?” box before betting.</li>
          <li>Add placed bets to <b className="text-ink">Portfolio</b>; sync results weekly during the season.</li>
        </ol>
      </Card>
      {GROUPS.map((g) => (
        <Card key={g.title} className="p-5">
          <SectionTitle>{g.title}</SectionTitle>
          <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2">
            {g.terms.map((t) => (
              <div key={t.name}>
                <div className="text-sm font-bold text-ink">{t.name}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{t.body}</p>
              </div>
            ))}
          </div>
        </Card>
      ))}
      <Card className="border-warn/25 bg-warn/5 p-5">
        <p className="text-[13px] leading-relaxed text-warn">
          The uncomfortable truth, in one paragraph: futures parlays are high-variance by
          construction, and positive EV only pays off across many bets over a long time. Bet
          amounts you can lose without caring, keep the Kelly multiplier at or below 25%, log
          everything, and treat any single result — win or lose — as noise. If it stops being fun:
          1-800-GAMBLER.
        </p>
      </Card>
    </div>
  );
}
