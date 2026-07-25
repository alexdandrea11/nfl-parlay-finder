import { NextResponse } from "next/server";
import { parseCustomBoard } from "@/lib/engine/customBoard";
import { getEngineView } from "@/lib/engine/engineCache";
import { search } from "@/lib/engine/search";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Moonshot finder: the most-likely parlay (PURE model probability, no
// anchor) whose payout clears a huge multiple. The pool is built for
// longshots: same-team futures LADDERS (division ⊂ conference ⊂ Super Bowl
// — books multiply the prices but the sim knows the joint probability is
// just the deepest rung) plus high-probability boosters to stretch payout.

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const stake = Math.max(1, Number(body.stake) || 100);
    const targetMultiple = Math.min(5000, Math.max(20, Number(body.targetMultiple) || 300));
    const maxLegs = Math.min(8, Math.max(2, Math.round(Number(body.maxLegs) || 6)));
    const options: EngineOptions = {
      adjustments: Array.isArray(body.adjustments) ? (body.adjustments as RatingAdjustment[]) : [],
      decidedGames: Array.isArray(body.decidedGames) ? (body.decidedGames as DecidedGame[]) : [],
      qbOverrides:
        body.qbOverrides && typeof body.qbOverrides === "object"
          ? (body.qbOverrides as Record<string, string>)
          : {},
    };
    const engine = await getEngineView(options, parseCustomBoard(body.customBoard));

    // Longshot-oriented pool: ladders of the strongest teams + boosters.
    const sbLegs = engine.legs
      .filter((l) => l.market === "superbowl")
      .sort((a, b) => b.modelProb - a.modelProb);
    const topTeams = sbLegs.slice(0, 6).map((l) => l.teamId);
    const ladder = engine.legs.filter(
      (l) =>
        topTeams.includes(l.teamId) &&
        ["superbowl", "conference", "division"].includes(l.market),
    );
    const boosters = engine.legs
      .filter((l) => !ladder.includes(l) && l.modelProb >= 0.5)
      .sort((a, b) => b.modelProb - a.modelProb)
      .slice(0, 10);
    const pool = [...ladder, ...boosters];

    const targetAmerican = Math.round((targetMultiple - 1) * 100);
    const result = search(engine.sim, pool, {
      minLegs: 2,
      maxLegs,
      markets: ["division", "playoffs", "conference", "superbowl", "winsOver", "winsUnder"],
      includeTeams: [],
      excludeTeams: [],
      maxLegsPerTeam: 4,
      minWinProb: 0,
      minEv: -1,
      minPayoutAmerican: targetAmerican,
      maxPayoutAmerican: null,
      allowCorrelated: true,
      anchorWeight: 0, // pure model conviction, as requested
      maxDivergence: null,
      requireLineShopEdge: false,
      sortBy: "prob",
      limit: 5,
      bankroll: stake,
      kellyMultiplier: 0.25,
    });

    return NextResponse.json({
      parlays: result.parlays,
      stake,
      targetMultiple,
      targetAmerican,
      evaluated: result.evaluated,
      sims: engine.sims,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "moonshot failed" },
      { status: 500 },
    );
  }
}
