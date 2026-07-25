import { NextResponse } from "next/server";
import { parseCustomBoard } from "@/lib/engine/customBoard";
import { getEngineView } from "@/lib/engine/engineCache";
import { search } from "@/lib/engine/search";
import type {
  DecidedGame,
  EngineOptions,
  MarketType,
  RatingAdjustment,
  SearchParams,
  SortObjective,
} from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALL_MARKETS: MarketType[] = [
  "division",
  "playoffs",
  "conference",
  "superbowl",
  "winsOver",
  "winsUnder",
];
const SORTS: SortObjective[] = ["ev", "prob", "value", "payout"];

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

function parseParams(body: Record<string, unknown>): SearchParams {
  const markets = Array.isArray(body.markets)
    ? (body.markets.filter((m) => ALL_MARKETS.includes(m as MarketType)) as MarketType[])
    : ALL_MARKETS;
  const minLegs = clampInt(body.minLegs, 2, 8, 2);
  const maxLegs = Math.max(minLegs, clampInt(body.maxLegs, 2, 8, 3));
  const sortBy = SORTS.includes(body.sortBy as SortObjective)
    ? (body.sortBy as SortObjective)
    : "value";
  return {
    minLegs,
    maxLegs,
    markets: markets.length ? markets : ALL_MARKETS,
    includeTeams: Array.isArray(body.includeTeams) ? (body.includeTeams as string[]) : [],
    excludeTeams: Array.isArray(body.excludeTeams) ? (body.excludeTeams as string[]) : [],
    maxLegsPerTeam: clampInt(body.maxLegsPerTeam, 1, 4, 1),
    minWinProb: Math.min(1, Math.max(0, Number(body.minWinProb) || 0)),
    minEv: Number.isFinite(Number(body.minEv)) ? Number(body.minEv) : -1,
    minPayoutAmerican:
      body.minPayoutAmerican == null || body.minPayoutAmerican === ""
        ? null
        : Number(body.minPayoutAmerican),
    maxPayoutAmerican:
      body.maxPayoutAmerican == null || body.maxPayoutAmerican === ""
        ? null
        : Number(body.maxPayoutAmerican),
    allowCorrelated: Boolean(body.allowCorrelated),
    anchorWeight: Number.isFinite(Number(body.anchorWeight))
      ? Math.min(1, Math.max(0, Number(body.anchorWeight)))
      : 0.3,
    maxDivergence:
      body.maxDivergence == null || body.maxDivergence === ""
        ? null
        : Math.max(0, Number(body.maxDivergence)),
    requireLineShopEdge: Boolean(body.requireLineShopEdge),
    sortBy,
    limit: clampInt(body.limit, 1, 100, 25),
    bankroll: Math.max(0, Number(body.bankroll) || 1000),
    kellyMultiplier: Math.min(1, Math.max(0, Number(body.kellyMultiplier) || 0.25)),
  };
}

function parseEngineOptions(body: Record<string, unknown>): EngineOptions {
  const adjustments: RatingAdjustment[] = Array.isArray(body.adjustments)
    ? (body.adjustments as unknown[])
        .map((a) => a as Record<string, unknown>)
        .filter((a) => a && typeof a.teamId === "string" && Number.isFinite(Number(a.delta)))
        .map((a) => ({ teamId: String(a.teamId), delta: Math.max(-400, Math.min(400, Number(a.delta))) }))
    : [];
  const decidedGames: DecidedGame[] = Array.isArray(body.decidedGames)
    ? (body.decidedGames as unknown[])
        .map((g) => g as Record<string, unknown>)
        .filter((g) => g && g.homeId && g.awayId && g.winnerId)
        .map((g) => ({ homeId: String(g.homeId), awayId: String(g.awayId), winnerId: String(g.winnerId) }))
    : [];
  const qbOverrides: Record<string, string> = {};
  if (body.qbOverrides && typeof body.qbOverrides === "object") {
    for (const [t, q] of Object.entries(body.qbOverrides as Record<string, unknown>)) {
      if (typeof q === "string" && q) qbOverrides[t] = q;
    }
  }
  return { adjustments, decidedGames, qbOverrides };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const params = parseParams(body);
    const options = parseEngineOptions(body);
    const board = parseCustomBoard(body.customBoard);
    const engine = await getEngineView(options, board);
    const t0 = performance.now();
    const result = search(engine.sim, engine.legs, params);
    const ms = Math.round(performance.now() - t0);
    return NextResponse.json({
      ...result,
      params,
      sims: engine.sims,
      searchMs: ms,
      adjustments: options.adjustments ?? [],
      conditioned: (options.decidedGames ?? []).length > 0,
      oddsMeta: engine.oddsMeta,
      customLegs: engine.customLegCount,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "search failed" },
      { status: 500 },
    );
  }
}
