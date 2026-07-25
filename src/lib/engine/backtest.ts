export interface Prediction {
  label: string;
  prob: number; // model probability at time of bet
  hit: boolean; // did it actually happen
  season?: string;
}

export interface CalibrationBin {
  lo: number;
  hi: number;
  predicted: number; // mean predicted prob in bin
  empirical: number; // fraction that hit
  count: number;
}

export interface BacktestResult {
  n: number;
  brier: number; // mean squared error; lower is better (0.25 = coin flip)
  logLoss: number;
  hitRate: number;
  meanPredicted: number;
  bins: CalibrationBin[];
}

/**
 * Generic calibration + accuracy metrics for a set of historical predictions.
 * Feed it real closing-line model probabilities paired with actual outcomes to
 * measure whether "20% bets" really hit ~20% of the time.
 */
export function backtest(predictions: Prediction[], binCount = 5): BacktestResult {
  const n = predictions.length;
  if (n === 0) {
    return { n: 0, brier: 0, logLoss: 0, hitRate: 0, meanPredicted: 0, bins: [] };
  }
  let brier = 0;
  let logLoss = 0;
  let hits = 0;
  let meanP = 0;
  for (const p of predictions) {
    const y = p.hit ? 1 : 0;
    const q = Math.min(0.9999, Math.max(0.0001, p.prob));
    brier += (q - y) ** 2;
    logLoss += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
    hits += y;
    meanP += p.prob;
  }

  const bins: CalibrationBin[] = [];
  for (let b = 0; b < binCount; b++) {
    const lo = b / binCount;
    const hi = (b + 1) / binCount;
    const group = predictions.filter((p) => p.prob >= lo && (p.prob < hi || (b === binCount - 1 && p.prob <= hi)));
    if (!group.length) continue;
    bins.push({
      lo,
      hi,
      predicted: group.reduce((a, p) => a + p.prob, 0) / group.length,
      empirical: group.filter((p) => p.hit).length / group.length,
      count: group.length,
    });
  }

  return {
    n,
    brier: brier / n,
    logLoss: logLoss / n,
    hitRate: hits / n,
    meanPredicted: meanP / n,
    bins,
  };
}
