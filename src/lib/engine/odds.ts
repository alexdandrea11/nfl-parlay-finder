// Odds conversions and vig removal.

export function americanToDecimal(american: number): number {
  if (american === 0) return 1;
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}

export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) return 0;
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1));
}

export function americanToImplied(american: number): number {
  const d = americanToDecimal(american);
  return d > 0 ? 1 / d : 0;
}

export function probToAmerican(prob: number): number {
  const p = Math.min(0.999, Math.max(0.001, prob));
  const decimal = 1 / p;
  return decimalToAmerican(decimal);
}

/** Format American odds with a leading sign. */
export function formatAmerican(american: number): string {
  return american > 0 ? `+${american}` : `${american}`;
}

/**
 * Remove vig from a set of mutually-exclusive outcomes using the
 * proportional (normalization) method. Returns fair probabilities that
 * sum to 1. Used to sanity-check the book's true opinion.
 */
export function devigProportional(impliedProbs: number[]): number[] {
  const total = impliedProbs.reduce((a, b) => a + b, 0);
  if (total <= 0) return impliedProbs.map(() => 0);
  return impliedProbs.map((p) => p / total);
}

/**
 * Anchor a model probability toward market consensus in log-odds space.
 * w = 0 returns the pure model; w = 1 returns the market. Log-odds blending
 * keeps small probabilities behaving sensibly (a 2% vs 6% disagreement is a
 * big deal; 42% vs 46% is not).
 */
export function anchorProb(model: number, market: number, w: number): number {
  if (w <= 0) return model;
  if (w >= 1) return market;
  const clamp = (p: number) => Math.min(0.9999, Math.max(0.0001, p));
  const logit = (p: number) => Math.log(p / (1 - p));
  const z = (1 - w) * logit(clamp(model)) + w * logit(clamp(market));
  return 1 / (1 + Math.exp(-z));
}

/** Expected value per $1 staked given a decimal price and true prob. */
export function expectedValue(decimalOdds: number, trueProb: number): number {
  return trueProb * decimalOdds - 1;
}

/**
 * Full-Kelly stake fraction for a single bet.
 * f* = (b*p - q) / b  where b = decimalOdds - 1, q = 1 - p.
 * Returns 0 when the edge is non-positive.
 */
export function kellyFraction(decimalOdds: number, trueProb: number): number {
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const q = 1 - trueProb;
  const f = (b * trueProb - q) / b;
  return Math.max(0, f);
}
