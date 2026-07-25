import { andBitset, buildLegBitset, countBits, wordsFor } from "./bitset";
import type { SimResult } from "./simulate";
import type { Leg } from "./types";

export interface TicketInput {
  legIds: string[];
  stake: number;
}

export interface TicketResult {
  legIds: string[];
  legLabels: string[];
  stake: number;
  combinedDecimal: number;
  combinedAmerican: number;
  jointProb: number;
  ev: number;
  toWin: number;
  valid: boolean;
}

export interface PortfolioResult {
  tickets: TicketResult[];
  totalStake: number;
  expectedPnl: number;
  expectedRoi: number;
  probProfit: number;
  probTotalLoss: number;
  best: number; // everything hits
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  exposure: { teamId: string; stake: number; pct: number }[];
}

function percentile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Evaluate a portfolio of parlay tickets against the shared simulation, so
 * correlation BETWEEN tickets is captured (e.g. five parlays all secretly
 * riding the same team). Returns the full P&L distribution, not just EV.
 */
export function evaluatePortfolio(
  sim: SimResult,
  legs: Leg[],
  tickets: TicketInput[],
): PortfolioResult {
  const N = sim.N;
  const byId = new Map(legs.map((l) => [l.id, l]));
  const pnl = new Float64Array(N);
  const results: TicketResult[] = [];
  const exposure = new Map<string, number>();
  let totalStake = 0;
  let best = 0;
  const ones = new Uint32Array(wordsFor(N)).fill(0xffffffff);

  for (const t of tickets) {
    const legObjs = t.legIds.map((id) => byId.get(id)).filter(Boolean) as Leg[];
    const valid = legObjs.length === t.legIds.length && legObjs.length > 0;
    if (!valid) {
      results.push({
        legIds: t.legIds,
        legLabels: legObjs.map((l) => l.label),
        stake: t.stake,
        combinedDecimal: 0,
        combinedAmerican: 0,
        jointProb: 0,
        ev: 0,
        toWin: 0,
        valid: false,
      });
      continue;
    }

    let and: Uint32Array = ones;
    let decimal = 1;
    for (const l of legObjs) {
      and = andBitset(and, buildLegBitset(sim, l));
      decimal *= l.decimalOdds;
    }
    const jointProb = countBits(and) / N;
    const profitIfWin = t.stake * (decimal - 1);

    // Accumulate this ticket's P&L across sims.
    for (let s = 0; s < N; s++) {
      const won = (and[s >>> 5] >>> (s & 31)) & 1;
      pnl[s] += won ? profitIfWin : -t.stake;
    }

    totalStake += t.stake;
    best += profitIfWin;
    for (const teamId of new Set(legObjs.map((l) => l.teamId))) {
      exposure.set(teamId, (exposure.get(teamId) ?? 0) + t.stake);
    }

    results.push({
      legIds: t.legIds,
      legLabels: legObjs.map((l) => l.label),
      stake: t.stake,
      combinedDecimal: decimal,
      combinedAmerican: decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1)),
      jointProb,
      ev: jointProb * decimal - 1,
      toWin: profitIfWin,
      valid: true,
    });
  }

  let sum = 0;
  let profitCount = 0;
  let totalLossCount = 0;
  for (let s = 0; s < N; s++) {
    sum += pnl[s];
    if (pnl[s] > 0) profitCount++;
    if (pnl[s] <= -totalStake + 1e-6) totalLossCount++;
  }
  const sorted = Float64Array.from(pnl).sort();

  return {
    tickets: results,
    totalStake,
    expectedPnl: sum / N,
    expectedRoi: totalStake > 0 ? sum / N / totalStake : 0,
    probProfit: profitCount / N,
    probTotalLoss: totalLossCount / N,
    best,
    percentiles: {
      p5: percentile(sorted, 0.05),
      p25: percentile(sorted, 0.25),
      p50: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      p95: percentile(sorted, 0.95),
    },
    exposure: [...exposure.entries()]
      .map(([teamId, stake]) => ({ teamId, stake, pct: totalStake > 0 ? stake / totalStake : 0 }))
      .sort((a, b) => b.stake - a.stake),
  };
}
