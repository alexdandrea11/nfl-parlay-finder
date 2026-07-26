import { NextResponse } from "next/server";
import { getGameLines } from "@/lib/data/gameLines";
import { getEngine } from "@/lib/engine/engineCache";
import {
  buildWinProbMatrices,
  eloToPts,
  probMarginOver,
  qbPassOffDelta,
  SCHEDULE,
} from "@/lib/engine/gameModel";
import { americanToDecimal, americanToImplied } from "@/lib/engine/odds";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Weekly game-line edges: the same matchup model that drives the season sim,
// pointed at individual upcoming games and compared to live market lines.

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

    // Model matrices with the user's current world (units, injuries, QBs).
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
    const { home: pHome, marginHome } = buildWinProbMatrices(
      teams,
      adjustPts,
      passOffDelta,
      engine.units,
    );

    // NFL week for each matchup (each ordered home|away pair is unique).
    const weekOf = new Map(SCHEDULE.map((s) => [`${s.home}|${s.away}`, s.week]));

    const lines = await getGameLines();
    const games = (lines?.games ?? []).map((g) => {
      const h = index[g.homeId];
      const a = index[g.awayId];
      if (h == null || a == null) return null;
      const modelPHome = pHome[h * T + a];
      const modelMargin = marginHome[h * T + a];

      const fd = g.books.find((b) => b.book === "fanduel");
      // Moneyline EVs at FanDuel.
      const evMlHome =
        fd?.mlHome != null ? modelPHome * americanToDecimal(fd.mlHome) - 1 : null;
      const evMlAway =
        fd?.mlAway != null ? (1 - modelPHome) * americanToDecimal(fd.mlAway) - 1 : null;
      // Spread: home covers when actual margin > -spreadHome.
      let pCoverHome: number | null = null;
      let evSpreadHome: number | null = null;
      let evSpreadAway: number | null = null;
      if (fd?.spreadHome != null) {
        pCoverHome = probMarginOver(modelMargin, -fd.spreadHome);
        if (fd.spreadHomePrice != null)
          evSpreadHome = pCoverHome * americanToDecimal(fd.spreadHomePrice) - 1;
        if (fd.spreadAwayPrice != null)
          evSpreadAway = (1 - pCoverHome) * americanToDecimal(fd.spreadAwayPrice) - 1;
      }
      // Market's own view for context (de-vigged FD moneyline).
      let mktPHome: number | null = null;
      if (fd?.mlHome != null && fd?.mlAway != null) {
        const ih = americanToImplied(fd.mlHome);
        const ia = americanToImplied(fd.mlAway);
        mktPHome = ih / (ih + ia);
      }
      return {
        eventId: g.eventId,
        commence: g.commence,
        week: weekOf.get(`${g.homeId}|${g.awayId}`) ?? null,
        homeId: g.homeId,
        awayId: g.awayId,
        modelPHome,
        modelMargin,
        mktPHome,
        fd: fd ?? null,
        bookCount: g.books.length,
        evMlHome,
        evMlAway,
        pCoverHome,
        evSpreadHome,
        evSpreadAway,
      };
    });

    return NextResponse.json({
      games: games.filter(Boolean),
      fetchedAt: lines?.fetchedAt ?? null,
      quotaRemaining: lines?.quotaRemaining ?? null,
      live: Boolean(lines),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "game lines failed" },
      { status: 500 },
    );
  }
}
