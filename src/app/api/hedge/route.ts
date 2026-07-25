import { NextResponse } from "next/server";
import { andBitset, buildLegBitset, countBits, wordsFor } from "@/lib/engine/bitset";
import { parseCustomBoard } from "@/lib/engine/customBoard";
import { getEngineView } from "@/lib/engine/engineCache";
import { americanToDecimal } from "@/lib/engine/odds";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hedge & cash-out advisor for one open ticket. Everything is conditional on
// the season SO FAR (the sim is already conditioned on synced results):
//   liveProb   — chance the ticket still cashes
//   fairValue  — what the ticket is truly worth right now
//   cash-out   — the book's offer vs fair value (the haircut, in dollars)
//   hedges     — counter-bets sized to maximize the worst-case outcome,
//                evaluated across the actual simulated branches

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const legIds = (Array.isArray(body.legIds) ? body.legIds : []).map(String);
    const stake = Math.max(0, Number(body.stake) || 0);
    const priceAmerican = Number(body.priceAmerican) || 0;
    const cashOutOffer = body.cashOutOffer == null ? null : Number(body.cashOutOffer);
    if (!legIds.length || !stake || !priceAmerican) {
      return NextResponse.json({ error: "legIds, stake, priceAmerican required" }, { status: 400 });
    }
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
    const byId = new Map(engine.legs.map((l) => [l.id, l]));

    const legs = legIds.map((id) => byId.get(id));
    if (legs.some((l) => !l)) {
      return NextResponse.json({ error: "unknown leg id (line changed?)" }, { status: 400 });
    }
    let ticketBits: Uint32Array = new Uint32Array(wordsFor(N)).fill(0xffffffff);
    for (const l of legs) ticketBits = andBitset(ticketBits, buildLegBitset(sim, l!));
    const pLive = countBits(ticketBits) / N;
    const totalReturn = stake * americanToDecimal(priceAmerican); // paid if it hits
    const fairValue = pLive * totalReturn;

    // Hedge candidates: liquid futures with meaningful probability, ranked by
    // the guaranteed floor they can create.
    const candidates = engine.legs.filter(
      (l) =>
        ["conference", "superbowl"].includes(l.market) &&
        !legIds.includes(l.id) &&
        l.modelProb > 0.02 &&
        l.modelProb < 0.9,
    );
    const hedges = [];
    for (const c of candidates) {
      const cBits = buildLegBitset(sim, c);
      const pBoth = countBits(andBitset(ticketBits, cBits)) / N;
      const pC = countBits(cBits) / N;
      const pTicketOnly = pLive - pBoth;
      const pHedgeOnly = pC - pBoth;
      const pNeither = Math.max(0, 1 - pLive - pHedgeOnly);
      const dh = c.decimalOdds;
      // Scan hedge stake for the best worst-case (from-now cashflows).
      let best = { h: 0, floor: pNeither > 0.001 ? 0 : totalReturn, ev: fairValue };
      for (let i = 1; i <= 60; i++) {
        const h = (i / 60) * fairValue * 3;
        const buckets: [number, number][] = [
          [pBoth, totalReturn + h * dh - h],
          [pTicketOnly, totalReturn - h],
          [pHedgeOnly, h * dh - h],
          [pNeither, -h],
        ];
        const occurring = buckets.filter(([p]) => p > 0.001);
        const floor = Math.min(...occurring.map(([, v]) => v));
        if (floor > best.floor) {
          best = {
            h,
            floor,
            ev: buckets.reduce((a, [p, v]) => a + p * v, 0),
          };
        }
      }
      if (best.h > 0) {
        hedges.push({
          legId: c.id,
          label: c.label,
          americanOdds: c.americanOdds,
          source: c.source,
          hedgeStake: Math.round(best.h),
          guaranteedFloor: Math.round(best.floor),
          evAfterHedge: Math.round(best.ev),
        });
      }
    }
    hedges.sort((a, b) => b.guaranteedFloor - a.guaranteedFloor);

    return NextResponse.json({
      pLive,
      totalReturn: Math.round(totalReturn),
      fairValue: Math.round(fairValue),
      cashOut:
        cashOutOffer != null && cashOutOffer > 0
          ? {
              offer: cashOutOffer,
              haircut: Math.round(fairValue - cashOutOffer),
              haircutPct: fairValue > 0 ? (fairValue - cashOutOffer) / fairValue : 0,
            }
          : null,
      hedges: hedges.slice(0, 6),
      sims: N,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "hedge failed" },
      { status: 500 },
    );
  }
}
