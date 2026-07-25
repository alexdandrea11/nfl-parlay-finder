import { NextResponse } from "next/server";
import { parseCustomBoard } from "@/lib/engine/customBoard";
import { getEngineView, type EngineView } from "@/lib/engine/engineCache";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Full leg board for browsing and for the portfolio ticket builder:
// every market/team with model prob, consensus, FanDuel price, and best book.

function respond(engine: EngineView) {
  const legs = engine.legs.map((l) => ({
    live: l.live,
    source: l.source,
    id: l.id,
    market: l.market,
    marketLabel: l.marketLabel,
    teamId: l.teamId,
    label: l.label,
    americanOdds: l.americanOdds,
    bestBook: l.bestBook,
    bestAmerican: l.bestAmerican,
    modelProb: l.modelProb,
    marketProb: l.marketProb,
    impliedProb: l.impliedProb,
    legEv: l.legEv,
    divergence: l.divergence,
    books: l.books,
  }));
  return NextResponse.json({
    legs,
    sims: engine.sims,
    oddsMeta: engine.oddsMeta,
    customLegs: engine.customLegCount,
  });
}

export async function GET() {
  return respond(await getEngineView());
}

// POST accepts the client's model state + FanDuel Price Board so the leg
// board reflects entered prices, custom win lines, QB swaps, and adjustments.
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
    const board = parseCustomBoard(body.customBoard);
    return respond(await getEngineView(options, board));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "legs failed" },
      { status: 500 },
    );
  }
}
