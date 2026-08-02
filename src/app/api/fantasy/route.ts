import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine/engineCache";
import { draftPlan, fantasyProjections, weekProjections, type Scoring } from "@/lib/engine/fantasy";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const scoring: Scoring = ["ppr", "half", "std"].includes(String(body.scoring))
      ? (String(body.scoring) as Scoring)
      : "ppr";
    const slot = Math.min(14, Math.max(1, Math.round(Number(body.slot) || 5)));
    const teams = Math.min(14, Math.max(6, Math.round(Number(body.teams) || 12)));
    const rounds = Math.min(16, Math.max(6, Math.round(Number(body.rounds) || 12)));
    const options: EngineOptions = {
      adjustments: Array.isArray(body.adjustments) ? (body.adjustments as RatingAdjustment[]) : [],
      decidedGames: Array.isArray(body.decidedGames) ? (body.decidedGames as DecidedGame[]) : [],
      qbOverrides:
        body.qbOverrides && typeof body.qbOverrides === "object"
          ? (body.qbOverrides as Record<string, string>)
          : {},
    };
    // Engine supplies in-season blended units so projections stay current.
    const engine = await getEngine(options);
    const rows = fantasyProjections(scoring, engine.units);
    const picks = draftPlan(rows, Math.min(slot, teams), teams, rounds);
    const week = body.week == null ? null : Math.min(18, Math.max(1, Math.round(Number(body.week))));
    const weekProj = week != null ? weekProjections(scoring, week, engine.units) : null;
    return NextResponse.json({
      scoring,
      slot: Math.min(slot, teams),
      teams,
      rounds,
      rows: rows.slice(0, 250),
      picks,
      week,
      weekProj,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fantasy failed" },
      { status: 500 },
    );
  }
}
