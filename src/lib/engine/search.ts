import { buildLegBitset } from "./bitset";
import { evaluateParlay } from "./parlay";
import { americanToImplied } from "./odds";
import type { SimResult } from "./simulate";
import type { Leg, Parlay, SearchParams, SortObjective } from "./types";

const MAX_POOL = 28; // cap candidate legs to keep combinatorics tractable
const MAX_EVAL = 750_000; // hard ceiling on parlays evaluated

export interface SearchResult {
  parlays: Parlay[];
  evaluated: number;
  poolSize: number;
  truncatedPool: boolean;
  hitEvalCap: boolean;
}

function scoreOf(p: Parlay, objective: SortObjective): number {
  switch (objective) {
    case "ev":
      return p.ev;
    case "prob":
      return p.jointProb;
    case "payout":
      return p.combinedDecimal;
    case "value": {
      // EV per unit of standard deviation (Bernoulli variance of the parlay).
      const variance = p.jointProb * (1 - p.jointProb) * p.combinedDecimal ** 2;
      const sd = Math.sqrt(Math.max(variance, 1e-9));
      return p.ev / sd;
    }
  }
}

/** Per-leg quality used only to decide which legs enter the candidate pool. */
function legQuality(leg: Leg): number {
  return leg.legEv * 0.7 + leg.modelProb * 0.3;
}

export function search(
  sim: SimResult,
  allLegs: Leg[],
  params: SearchParams,
): SearchResult {
  const include = new Set(params.includeTeams);
  const exclude = new Set(params.excludeTeams);
  const markets = new Set(params.markets);

  // 1. Filter to eligible legs.
  let pool = allLegs.filter((l) => {
    if (!markets.has(l.market)) return false;
    if (exclude.has(l.teamId)) return false;
    if (include.size > 0 && !include.has(l.teamId)) return false;
    // Suppress legs where the model wildly disagrees with market consensus —
    // usually a model artifact rather than real edge.
    if (params.maxDivergence != null && Math.abs(l.divergence) > params.maxDivergence)
      return false;
    return true;
  });

  // 2. Cap the pool by per-leg quality to keep the search fast.
  pool.sort((a, b) => legQuality(b) - legQuality(a));
  const truncatedPool = pool.length > MAX_POOL;
  pool = pool.slice(0, MAX_POOL);

  // Precompute each pooled leg's simulation bitset once.
  const bitsets = pool.map((l) => buildLegBitset(sim, l));
  const words = bitsets[0]?.length ?? 0;

  const effectiveMaxPerTeam = params.allowCorrelated
    ? Math.max(1, params.maxLegsPerTeam)
    : 1;

  const minPayoutImplied =
    params.minPayoutAmerican != null
      ? americanToImplied(params.minPayoutAmerican)
      : null;
  const maxPayoutImplied =
    params.maxPayoutAmerican != null
      ? americanToImplied(params.maxPayoutAmerican)
      : null;

  const results: Parlay[] = [];
  let evaluated = 0;
  let hitEvalCap = false;

  const teamCounts = new Map<string, number>();
  const chosen: number[] = [];
  // Running AND bitset stack for incremental joint-probability pruning.
  const stack: Uint32Array[] = [new Uint32Array(words).fill(0xffffffff)];

  const dfs = (start: number) => {
    if (hitEvalCap) return;
    const depth = chosen.length;

    // Evaluate a complete parlay if within the leg-count window.
    if (depth >= params.minLegs && depth <= params.maxLegs) {
      const legs = chosen.map((i) => pool[i]);
      const parlay = evaluateParlay(legs, stack[depth], sim.N, params.kellyMultiplier);
      evaluated++;
      if (evaluated >= MAX_EVAL) hitEvalCap = true;

      const combinedAmericanImplied = 1 / parlay.combinedDecimal;
      // FanDuel is best-or-tied on every leg → you lose nothing by betting FD.
      const fdIsBestEverywhere = legs.every((l) => l.decimalOdds >= l.bestDecimal - 1e-9);
      const passes =
        !parlay.impossible &&
        parlay.jointProb >= params.minWinProb &&
        parlay.ev >= params.minEv &&
        (minPayoutImplied == null || combinedAmericanImplied <= minPayoutImplied) &&
        (maxPayoutImplied == null || combinedAmericanImplied >= maxPayoutImplied) &&
        (!params.requireLineShopEdge || fdIsBestEverywhere);
      if (passes) {
        parlay.score = scoreOf(parlay, params.sortBy);
        results.push(parlay);
      }
    }

    if (depth >= params.maxLegs || hitEvalCap) return;

    for (let i = start; i < pool.length; i++) {
      const leg = pool[i];
      const tc = teamCounts.get(leg.teamId) ?? 0;
      if (tc >= effectiveMaxPerTeam) continue;

      // Incremental AND with the running bitset; prune impossible branches.
      const prev = stack[depth];
      const next = stack[depth + 1] ?? (stack[depth + 1] = new Uint32Array(words));
      let any = 0;
      const b = bitsets[i];
      for (let w = 0; w < words; w++) {
        const v = prev[w] & b[w];
        next[w] = v;
        any |= v;
      }
      // All-zero joint = impossible combo (e.g. two teams winning the same
      // division). Adding more legs can never make it non-zero, so skip.
      if (any === 0) continue;

      chosen.push(i);
      teamCounts.set(leg.teamId, tc + 1);
      dfs(i + 1);
      chosen.pop();
      teamCounts.set(leg.teamId, tc);
      if (hitEvalCap) return;
    }
  };

  if (pool.length > 0) dfs(0);

  // Rank and trim.
  results.sort((a, b) => b.score - a.score);
  const parlays = results.slice(0, params.limit);

  return {
    parlays,
    evaluated,
    poolSize: pool.length,
    truncatedPool,
    hitEvalCap,
  };
}
