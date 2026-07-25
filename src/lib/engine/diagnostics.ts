import type { Leg, MarketType, Team } from "./types";

export interface Check {
  name: string;
  expected: number;
  actual: number;
  ok: boolean;
}

/**
 * Structural invariants the simulation MUST satisfy. These validate the
 * engine itself: e.g. exactly one team wins each division, so division-winner
 * probabilities within a division must sum to 1; seven teams make the
 * playoffs per conference, so those probabilities sum to 7.
 */
export function engineInvariants(legs: Leg[], teams: Team[]): Check[] {
  const checks: Check[] = [];
  const tol = 0.02;
  const probOf = (market: MarketType, teamId: string) =>
    legs.find((l) => l.market === market && l.teamId === teamId)?.modelProb ?? 0;

  const confs = ["AFC", "NFC"] as const;
  const divs = ["East", "North", "South", "West"] as const;

  for (const c of confs) {
    for (const d of divs) {
      const ids = teams.filter((t) => t.conference === c && t.division === d).map((t) => t.id);
      const sum = ids.reduce((a, id) => a + probOf("division", id), 0);
      checks.push({ name: `${c} ${d}: one division winner`, expected: 1, actual: sum, ok: Math.abs(sum - 1) < tol });
    }
    const confIds = teams.filter((t) => t.conference === c).map((t) => t.id);
    const playoffSum = confIds.reduce((a, id) => a + probOf("playoffs", id), 0);
    checks.push({ name: `${c}: 7 playoff teams`, expected: 7, actual: playoffSum, ok: Math.abs(playoffSum - 7) < tol * 7 });
    const confSum = confIds.reduce((a, id) => a + probOf("conference", id), 0);
    checks.push({ name: `${c}: one conference champ`, expected: 1, actual: confSum, ok: Math.abs(confSum - 1) < tol });
  }
  const sbSum = teams.reduce((a, t) => a + probOf("superbowl", t.id), 0);
  checks.push({ name: "One Super Bowl champion", expected: 1, actual: sbSum, ok: Math.abs(sbSum - 1) < tol });
  return checks;
}

export interface AgreementBin {
  center: number;
  meanMarket: number;
  meanModel: number;
  count: number;
}

export interface Agreement {
  rmse: number;
  bias: number; // mean(model - market)
  bins: AgreementBin[];
  byMarket: { market: MarketType; rmse: number; count: number }[];
}

/**
 * How far the model departs from vig-removed market consensus. The market is
 * the sharpest available "truth" proxy before games are played, so large,
 * systematic divergence is a warning that the ratings need tuning.
 */
export function modelVsMarket(legs: Leg[]): Agreement {
  const usable = legs.filter((l) => l.marketProb > 0.001 && l.marketProb < 0.999);
  const n = usable.length || 1;
  let se = 0;
  let bias = 0;
  for (const l of usable) {
    se += (l.modelProb - l.marketProb) ** 2;
    bias += l.modelProb - l.marketProb;
  }
  const rmse = Math.sqrt(se / n);

  const bins: AgreementBin[] = [];
  for (let b = 0; b < 10; b++) {
    const lo = b / 10;
    const hi = (b + 1) / 10;
    const group = usable.filter((l) => l.marketProb >= lo && l.marketProb < hi);
    if (!group.length) continue;
    bins.push({
      center: (lo + hi) / 2,
      meanMarket: group.reduce((a, l) => a + l.marketProb, 0) / group.length,
      meanModel: group.reduce((a, l) => a + l.modelProb, 0) / group.length,
      count: group.length,
    });
  }

  const markets = [...new Set(usable.map((l) => l.market))];
  const byMarket = markets.map((m) => {
    const g = usable.filter((l) => l.market === m);
    const mse = g.reduce((a, l) => a + (l.modelProb - l.marketProb) ** 2, 0) / g.length;
    return { market: m, rmse: Math.sqrt(mse), count: g.length };
  });

  return { rmse, bias: bias / n, bins, byMarket };
}
