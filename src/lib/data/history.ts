import { mulberry32 } from "../engine/random";
import type { Prediction } from "../engine/backtest";

/**
 * SYNTHETIC example history so the backtest/calibration view renders out of
 * the box. These are NOT real results — they are generated as a
 * perfectly-calibrated reference (outcomes drawn Bernoulli(prob)) to show what
 * a well-calibrated model looks like.
 *
 * Replace with real data: your model's probability for each past futures bet
 * at bet time, paired with whether it actually hit. Then this view tells you
 * if the model is trustworthy.
 */
export const IS_SYNTHETIC = true;

export const HISTORY: Prediction[] = (() => {
  const rnd = mulberry32(424242);
  const out: Prediction[] = [];
  const seasons = ["2021", "2022", "2023", "2024"];
  for (let i = 0; i < 80; i++) {
    const prob = 0.03 + rnd() * 0.9;
    out.push({
      label: `historical futures bet #${i + 1}`,
      prob,
      hit: rnd() < prob,
      season: seasons[i % seasons.length],
    });
  }
  return out;
})();
