import { NextResponse } from "next/server";
import { andBitset, buildLegBitset, wordsFor } from "@/lib/engine/bitset";
import { parseCustomBoard } from "@/lib/engine/customBoard";
import { getEngineView } from "@/lib/engine/engineCache";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Personal leverage board: for the next week's games (tracked per-sim), how
// much does each result swing (a) your open tickets' expected value and
// (b) the involved teams' playoff odds. "Which games actually move MY money."

interface Ticket {
  legIds: string[];
  stake: number;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const tickets = (Array.isArray(body.tickets) ? body.tickets : []) as Ticket[];
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

    // Portfolio P&L per sim.
    const pnl = new Float64Array(N);
    let anyTicket = false;
    for (const t of tickets) {
      const legs = t.legIds.map((id) => byId.get(id)).filter(Boolean);
      if (legs.length !== t.legIds.length || !t.stake) continue;
      anyTicket = true;
      let bits: Uint32Array = new Uint32Array(wordsFor(N)).fill(0xffffffff);
      let dec = 1;
      for (const l of legs) {
        bits = andBitset(bits, buildLegBitset(sim, l!));
        dec *= l!.decimalOdds;
      }
      const win = t.stake * (dec - 1);
      for (let s = 0; s < N; s++) {
        pnl[s] += (bits[s >>> 5] >>> (s & 31)) & 1 ? win : -t.stake;
      }
    }

    const games = sim.trackedGames.map((g) => {
      let nH = 0;
      let pnlH = 0;
      let pnlA = 0;
      const hIdx = sim.index[g.homeId] * N;
      const aIdx = sim.index[g.awayId] * N;
      let poHomeH = 0, poHomeA = 0, poAwayH = 0, poAwayA = 0;
      for (let s = 0; s < N; s++) {
        const homeWon = (g.homeBits[s >>> 5] >>> (s & 31)) & 1;
        if (homeWon) {
          nH++;
          pnlH += pnl[s];
          poHomeH += sim.madePlayoffs[hIdx + s];
          poAwayH += sim.madePlayoffs[aIdx + s];
        } else {
          pnlA += pnl[s];
          poHomeA += sim.madePlayoffs[hIdx + s];
          poAwayA += sim.madePlayoffs[aIdx + s];
        }
      }
      const nA = N - nH;
      const evH = nH ? pnlH / nH : 0;
      const evA = nA ? pnlA / nA : 0;
      return {
        homeId: g.homeId,
        awayId: g.awayId,
        week: g.week,
        pHome: nH / N,
        portfolioSwing: anyTicket ? evH - evA : null,
        homePlayoffSwing: (nH ? poHomeH / nH : 0) - (nA ? poHomeA / nA : 0),
        awayPlayoffSwing: (nH ? poAwayH / nH : 0) - (nA ? poAwayA / nA : 0),
      };
    });

    games.sort((a, b) =>
      Math.abs(b.portfolioSwing ?? b.homePlayoffSwing) - Math.abs(a.portfolioSwing ?? a.homePlayoffSwing),
    );
    return NextResponse.json({ week: games[0]?.week ?? null, games, hasTickets: anyTicket, sims: N });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "leverage failed" },
      { status: 500 },
    );
  }
}
