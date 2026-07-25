import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine/engineCache";
import {
  buildWinProbMatrices,
  eloToPts,
  probMarginOver,
  qbPassOffDelta,
  restAdjustment,
  SCHEDULE,
} from "@/lib/engine/gameModel";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Week-by-week model predictions: every team's 18-week slate with the
// model's win probability for each game (rest-adjusted), plus actual
// results where games have been played.

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
    const engine = await getEngine(options);
    const teams = engine.teams;
    const T = teams.length;
    const index = engine.sim.index;

    const adjustPts = new Float64Array(T);
    for (const a of options.adjustments ?? []) {
      const i = index[a.teamId];
      if (i != null) adjustPts[i] += eloToPts(a.delta);
    }
    const passOffDelta = new Float64Array(T);
    for (const [teamId, qbId] of Object.entries(options.qbOverrides ?? {})) {
      const i = index[teamId];
      if (i != null) passOffDelta[i] = qbPassOffDelta(teamId, qbId);
    }
    const { marginHome } = buildWinProbMatrices(teams, adjustPts, passOffDelta, engine.units);

    const decided = new Map(
      (options.decidedGames ?? []).map((g) => [`${g.homeId}|${g.awayId}`, g.winnerId]),
    );
    const weeks = [...new Set(SCHEDULE.map((g) => g.week))].sort((a, b) => a - b);
    const rows = teams.map((t) => {
      const cells: ({ week: number; opp: string; home: boolean; pWin: number; result: "W" | "L" | null } | null)[] =
        weeks.map(() => null);
      for (const g of SCHEDULE) {
        const isHome = g.home === t.id;
        const isAway = g.away === t.id;
        if (!isHome && !isAway) continue;
        const h = index[g.home];
        const a = index[g.away];
        const margin = marginHome[h * T + a] + restAdjustment(g.hRest, g.aRest);
        const pHome = probMarginOver(margin, 0);
        const winner = decided.get(`${g.home}|${g.away}`);
        cells[g.week - 1] = {
          week: g.week,
          opp: isHome ? g.away : g.home,
          home: isHome,
          pWin: isHome ? pHome : 1 - pHome,
          result: winner ? (winner === t.id ? "W" : "L") : null,
        };
      }
      const projWins = cells.reduce((s, c) => s + (c ? c.pWin : 0), 0);
      return { id: t.id, name: t.name, conference: t.conference, division: t.division, projWins, cells };
    });
    rows.sort((a, b) => b.projWins - a.projWins);
    return NextResponse.json({ weeks, rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "gauntlet failed" },
      { status: 500 },
    );
  }
}
