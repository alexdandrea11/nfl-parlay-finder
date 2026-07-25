import { countBits } from "./bitset";
import { anchorProb, decimalToAmerican, kellyFraction } from "./odds";
import type { Leg, Parlay } from "./types";

/**
 * Evaluate a fully-assembled parlay. `andBits` is the precomputed logical
 * AND of every leg's simulation bitset (sims where all legs hit).
 *
 * `anchorWeight` pulls each leg's probability toward market consensus in
 * log-odds space; the joint probability is rescaled by the product of the
 * per-leg ratios, which preserves the simulation's correlation structure
 * while tempering the marginals.
 */
export function evaluateParlay(
  legs: Leg[],
  andBits: Uint32Array,
  N: number,
  kellyMultiplier: number,
  anchorWeight = 0,
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

  // Anchor: rescale the joint by the product of per-leg anchored/model ratios.
  let anchorRatio = 1;
  if (anchorWeight > 0) {
    for (const leg of legs) {
      const anchored = anchorProb(leg.modelProb, leg.marketProb, anchorWeight);
      anchorRatio *= anchored / Math.max(1e-6, leg.modelProb);
    }
  }
  const anchoredProb = Math.min(1, Math.max(0, jointProb * anchorRatio));

  const ev = jointProb * combinedDecimal - 1;
  const evAnchored = anchoredProb * combinedDecimal - 1;
  const evBest = jointProb * bestCombinedDecimal - 1;
  const kelly = kellyFraction(combinedDecimal, anchoredProb) * kellyMultiplier;
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
    anchoredProb,
    impliedProb,
    marketProb,
    ev,
    evAnchored,
    evBest,
    roi: ev,
    kellyFraction: kelly,
    correlation,
    impossible: jointProb === 0,
    score: 0,
  };
}
