import { NextResponse } from "next/server";
import { parseCustomBoard } from "@/lib/engine/customBoard";
import { getEngineView } from "@/lib/engine/engineCache";
import { evaluatePortfolio, type TicketInput } from "@/lib/engine/portfolio";
import type { EngineOptions } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Evaluate a set of parlay tickets as ONE book: joint P&L distribution across
// the shared simulation (captures correlation between tickets), team
// exposure, and per-ticket stats. Accepts the same engine options as /search
// so the portfolio can be re-marked mid-season.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const tickets: TicketInput[] = Array.isArray(body.tickets)
      ? (body.tickets as unknown[])
          .map((t) => t as Record<string, unknown>)
          .filter((t) => Array.isArray(t.legIds) && t.legIds.length > 0)
          .map((t) => ({
            legIds: (t.legIds as unknown[]).map(String),
            stake: Math.max(0, Number(t.stake) || 0),
          }))
          .filter((t) => t.stake > 0)
      : [];
    if (tickets.length === 0) {
      return NextResponse.json({ error: "no tickets provided" }, { status: 400 });
    }
    if (tickets.length > 50) {
      return NextResponse.json({ error: "max 50 tickets" }, { status: 400 });
    }

    const options = (body.engineOptions ?? {}) as EngineOptions;
    const engine = await getEngineView(
      {
        adjustments: Array.isArray(options.adjustments) ? options.adjustments : [],
        decidedGames: Array.isArray(options.decidedGames) ? options.decidedGames : [],
        qbOverrides:
          options.qbOverrides && typeof options.qbOverrides === "object" ? options.qbOverrides : {},
      },
      parseCustomBoard(body.customBoard),
    );
    const result = evaluatePortfolio(engine.sim, engine.legs, tickets);
    return NextResponse.json({ ...result, sims: engine.sims });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "portfolio evaluation failed" },
      { status: 500 },
    );
  }
}
