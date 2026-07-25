import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine/engineCache";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scenario sandbox: compare the season simulated WITH hypothetical results
// vs the baseline. Both runs hit the variant cache, so toggling scenarios is
// fast after the first computation.

function teamStats(engine: Awaited<ReturnType<typeof getEngine>>) {
  const { sim } = engine;
  const N = sim.N;
  return engine.teams.map((t) => {
    const base = sim.index[t.id] * N;
    let wins = 0;
    let playoffs = 0;
    let division = 0;
    let sb = 0;
    for (let s = 0; s < N; s++) {
      wins += sim.winCounts[base + s];
      playoffs += sim.madePlayoffs[base + s];
      division += sim.wonDivision[base + s];
      sb += sim.wonSuperbowl[base + s];
    }
    return {
      id: t.id,
      name: t.name,
      meanWins: wins / N,
      pPlayoffs: playoffs / N,
      pDivision: division / N,
      pSb: sb / N,
    };
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const base: EngineOptions = {
      adjustments: Array.isArray(body.adjustments) ? (body.adjustments as RatingAdjustment[]) : [],
      decidedGames: Array.isArray(body.decidedGames) ? (body.decidedGames as DecidedGame[]) : [],
      qbOverrides:
        body.qbOverrides && typeof body.qbOverrides === "object"
          ? (body.qbOverrides as Record<string, string>)
          : {},
    };
    const scenarioGames = Array.isArray(body.scenarioGames)
      ? (body.scenarioGames as DecidedGame[])
      : [];

    const baseline = await getEngine(base);
    // Scenario results are merged on top of any real results (scenario wins
    // conflicts — you're overriding the world).
    const key = (g: DecidedGame) => `${g.homeId}|${g.awayId}`;
    const scenarioKeys = new Set(scenarioGames.map(key));
    const merged = [
      ...scenarioGames,
      ...(base.decidedGames ?? []).filter((g) => !scenarioKeys.has(key(g))),
    ];
    const scenario = await getEngine({ ...base, decidedGames: merged });

    return NextResponse.json({
      baseline: teamStats(baseline),
      scenario: teamStats(scenario),
      scenarioCount: scenarioGames.length,
      sims: baseline.sims,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "scenario failed" },
      { status: 500 },
    );
  }
}
