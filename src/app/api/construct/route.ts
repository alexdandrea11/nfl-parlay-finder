import { NextResponse } from "next/server";
import { andBitset, buildLegBitset, wordsFor } from "@/lib/engine/bitset";
import { parseCustomBoard } from "@/lib/engine/customBoard";
import { getEngineView } from "@/lib/engine/engineCache";
import { search } from "@/lib/engine/search";
import type { DecidedGame, EngineOptions, Parlay, RatingAdjustment, SearchParams } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Portfolio constructor: given a budget and an objective, greedily assemble
// the best SET of tickets — evaluated jointly across the same simulated
// seasons, so diversification and correlation between tickets are real, not
// assumed.

const BASE: SearchParams = {
  minLegs: 2, maxLegs: 3, markets: ["division", "playoffs", "conference", "superbowl", "winsOver", "winsUnder"],
  includeTeams: [], excludeTeams: [], maxLegsPerTeam: 1, minWinProb: 0, minEv: -1,
  minPayoutAmerican: null, maxPayoutAmerican: null, allowCorrelated: false, anchorWeight: 0.3,
  maxDivergence: 0.2, requireLineShopEdge: false, sortBy: "value", limit: 15, bankroll: 1000, kellyMultiplier: 0.25,
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const budget = Math.max(10, Number(body.budget) || 500);
    const objective = ["pProfit", "median", "upside"].includes(String(body.objective))
      ? (String(body.objective) as "pProfit" | "median" | "upside")
      : "pProfit";
    const options: EngineOptions = {
      adjustments: Array.isArray(body.adjustments) ? (body.adjustments as RatingAdjustment[]) : [],
      decidedGames: Array.isArray(body.decidedGames) ? (body.decidedGames as DecidedGame[]) : [],
      qbOverrides:
        body.qbOverrides && typeof body.qbOverrides === "object"
          ? (body.qbOverrides as Record<string, string>)
          : {},
    };
    const engine = await getEngineView(options, parseCustomBoard(body.customBoard));
    const { sim } = engine;
    const N = sim.N;

    // Candidate pool from three complementary hunting styles.
    const presets: Partial<SearchParams>[] = [
      { sortBy: "value", minEv: 0, minWinProb: 0.15 },
      { sortBy: "prob", minEv: 0.03, minWinProb: 0.3, maxLegs: 2 },
      { sortBy: "prob", minPayoutAmerican: 5000, allowCorrelated: true, maxLegsPerTeam: 4, maxLegs: 5, anchorWeight: 0 },
    ];
    const seen = new Set<string>();
    const candidates: { p: Parlay; bits: Uint32Array; dec: number }[] = [];
    const byId = new Map(engine.legs.map((l) => [l.id, l]));
    for (const preset of presets) {
      const res = search(sim, engine.legs, { ...BASE, ...preset });
      for (const p of res.parlays) {
        const key = p.legs.map((l) => l.id).sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        let bits: Uint32Array = new Uint32Array(wordsFor(N)).fill(0xffffffff);
        for (const l of p.legs) bits = andBitset(bits, buildLegBitset(sim, byId.get(l.id)!));
        candidates.push({ p, bits, dec: p.combinedDecimal });
      }
    }

    // Greedy: up to 5 tickets, equal stakes, maximize the objective on a
    // sim sample (full-N stats reported at the end).
    const MAX_T = 5;
    const unit = Math.floor(budget / MAX_T);
    const SAMPLE = 4000;
    const step = Math.max(1, Math.floor(N / SAMPLE));
    const idxs: number[] = [];
    for (let s = 0; s < N; s += step) idxs.push(s);
    const score = (pnl: Float64Array): number => {
      if (objective === "pProfit") {
        let c = 0;
        for (const s of idxs) if (pnl[s] > 0) c++;
        return c / idxs.length;
      }
      const vals = idxs.map((s) => pnl[s]).sort((a, b) => a - b);
      return objective === "median"
        ? vals[Math.floor(vals.length / 2)]
        : vals[Math.floor(vals.length * 0.95)];
    };
    const pnl = new Float64Array(N);
    const chosen: { p: Parlay; stake: number }[] = [];
    const used = new Set<number>();
    for (let k = 0; k < MAX_T; k++) {
      let bestI = -1;
      let bestScore = score(pnl);
      let bestPnl: Float64Array | null = null;
      for (let i = 0; i < candidates.length; i++) {
        if (used.has(i)) continue;
        const c = candidates[i];
        const win = unit * (c.dec - 1);
        const trial = Float64Array.from(pnl);
        for (const s of idxs) {
          trial[s] += (c.bits[s >>> 5] >>> (s & 31)) & 1 ? win : -unit;
        }
        const sc = score(trial);
        if (sc > bestScore) {
          bestScore = sc;
          bestI = i;
          bestPnl = trial;
        }
      }
      if (bestI < 0 || !bestPnl) break;
      used.add(bestI);
      const c = candidates[bestI];
      chosen.push({ p: c.p, stake: unit });
      const win = unit * (c.dec - 1);
      for (let s = 0; s < N; s++) pnl[s] += (c.bits[s >>> 5] >>> (s & 31)) & 1 ? win : -unit;
    }

    // Full-N summary.
    let profitC = 0;
    let sum = 0;
    for (let s = 0; s < N; s++) {
      if (pnl[s] > 0) profitC++;
      sum += pnl[s];
    }
    const sorted = Float64Array.from(pnl).sort();
    const q = (x: number) => Math.round(sorted[Math.floor(N * x)]);

    return NextResponse.json({
      objective,
      budget,
      tickets: chosen.map((c) => ({ legs: c.p.legs, stake: c.stake, combinedAmerican: c.p.combinedAmerican, jointProb: c.p.jointProb, ev: c.p.evAnchored })),
      summary: {
        staked: chosen.length * unit,
        pProfit: profitC / N,
        expectedPnl: Math.round(sum / N),
        p5: q(0.05), p50: q(0.5), p95: q(0.95),
      },
      candidateCount: candidates.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "construct failed" },
      { status: 500 },
    );
  }
}
