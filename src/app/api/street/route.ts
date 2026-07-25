import { NextResponse } from "next/server";
import { parseCustomBoard } from "@/lib/engine/customBoard";
import { getEngineView } from "@/lib/engine/engineCache";
import { EXPERTS, powerPts } from "@/lib/engine/gameModel";
import { probToAmerican } from "@/lib/engine/odds";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Model vs street vs experts: per-team three-way comparison plus the legs
// where our model most disagrees with the market (the outlier candidates).

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
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

    const teams = engine.teams.map((t) => {
      const i = sim.index[t.id];
      const base = i * N;
      let wins = 0;
      let playoffs = 0;
      let sb = 0;
      for (let s = 0; s < N; s++) {
        wins += sim.winCounts[base + s];
        playoffs += sim.madePlayoffs[base + s];
        sb += sim.wonSuperbowl[base + s];
      }
      const sbLeg = engine.legs.find((l) => l.market === "superbowl" && l.teamId === t.id);
      const poLeg = engine.legs.find((l) => l.market === "playoffs" && l.teamId === t.id);
      const exp = EXPERTS?.teams[t.id];
      return {
        id: t.id,
        name: t.name,
        conference: t.conference,
        division: t.division,
        power: Math.round(powerPts(t.id) * 10) / 10,
        fpi: exp?.fpi ?? null,
        meanWins: wins / N,
        fpiProjWins: exp?.projWins ?? null,
        pSb: sb / N,
        mktSb: sbLeg?.marketProb ?? null,
        sbSource: sbLeg?.source ?? "sample",
        pPlayoffs: playoffs / N,
        mktPlayoffs: poLeg?.marketProb ?? null,
      };
    });

    // Agreement headline numbers.
    const withFpi = teams.filter((t) => t.fpi != null);
    const powerVsFpi = pearson(
      withFpi.map((t) => t.power),
      withFpi.map((t) => t.fpi as number),
    );
    const winsVsFpi = pearson(
      withFpi.map((t) => t.meanWins),
      withFpi.map((t) => t.fpiProjWins as number),
    );
    const winsGap =
      withFpi.reduce((a, t) => a + Math.abs(t.meanWins - (t.fpiProjWins as number)), 0) /
      Math.max(1, withFpi.length);

    // Outliers: legs where model and market disagree most.
    const outliers = [...engine.legs]
      .filter((l) => l.marketProb > 0.005 && l.marketProb < 0.995)
      .sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence))
      .slice(0, 15)
      .map((l) => ({
        id: l.id,
        label: l.label,
        market: l.market,
        source: l.source,
        modelProb: l.modelProb,
        marketProb: l.marketProb,
        divergence: l.divergence,
        americanOdds: l.americanOdds,
        fairAmerican: probToAmerican(l.modelProb),
        legEv: l.legEv,
      }));

    // Scatter data: every leg's model vs market probability.
    const scatter = engine.legs
      .filter((l) => l.marketProb > 0.002 && l.marketProb < 0.998)
      .map((l) => ({
        label: l.label,
        market: l.market,
        model: l.modelProb,
        mkt: l.marketProb,
        source: l.source,
      }));

    return NextResponse.json({
      teams: teams.sort((a, b) => b.power - a.power),
      experts: EXPERTS
        ? { source: EXPERTS.source, season: EXPERTS.season, updatedAt: EXPERTS.updatedAt }
        : null,
      agreement: { powerVsFpi, winsVsFpi, winsGap },
      outliers,
      scatter,
      sims: N,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "street comparison failed" },
      { status: 500 },
    );
  }
}
