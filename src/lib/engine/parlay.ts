import { countBits } from "./bitset";
import { decimalToAmerican, kellyFraction } from "./odds";
import type { Leg, Parlay } from "./types";

/**
 * Evaluate a fully-assembled parlay. `andBits` is the precomputed logical
 * AND of every leg's simulation bitset (sims where all legs hit).
 */
export function evaluateParlay(
  legs: Leg[],
  andBits: Uint32Array,
  N: number,
  kellyMultiplier: number,
): Parlay {
  let combinedDecimal = 1;
  let bestCombinedDecimal = 1;
  let independentProb = 1;
  let impliedProb = 1;
  let marketProb = 1;
  for (const leg of legs) {
    combinedDecimal *= leg.decimalOdds;
    bestCombinedDecimal *= leg.bestDecimal;
    independentProb *= leg.modelProb;
    impliedProb *= leg.impliedProb;
    marketProb *= leg.marketProb;
  }
  const jointProb = countBits(andBits) / N;
  const ev = jointProb * combinedDecimal - 1;
  const evBest = jointProb * bestCombinedDecimal - 1;
  const kelly = kellyFraction(combinedDecimal, jointProb) * kellyMultiplier;
  const correlation = independentProb > 0 ? jointProb / independentProb : 1;

  return {
    legs: legs.map((l) => ({
      id: l.id,
      label: l.label,
      market: l.market,
      teamId: l.teamId,
      americanOdds: l.americanOdds,
      decimalOdds: l.decimalOdds,
      bestBook: l.bestBook,
      bestAmerican: l.bestAmerican,
      modelProb: l.modelProb,
      marketProb: l.marketProb,
      impliedProb: l.impliedProb,
    })),
    combinedDecimal,
    combinedAmerican: decimalToAmerican(combinedDecimal),
    bestCombinedDecimal,
    bestCombinedAmerican: decimalToAmerican(bestCombinedDecimal),
    independentProb,
    jointProb,
    impliedProb,
    marketProb,
    ev,
    evBest,
    roi: ev,
    kellyFraction: kelly,
    correlation,
    impossible: jointProb === 0,
    score: 0,
  };
}
