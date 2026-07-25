import { NextResponse } from "next/server";
import { hasStore, readDoc, writeDoc } from "@/lib/data/store";
import { gradeBets, loadBets, refreshClv } from "@/lib/engine/betService";
import { parseCustomBoard } from "@/lib/engine/customBoard";
import { getEngineView } from "@/lib/engine/engineCache";
import { search } from "@/lib/engine/search";
import type { RatingAdjustment, SearchParams } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily housekeeping (Vercel Cron):
//   1. snapshot real prices (live feed + board) for CLV / line history
//   2. run every saved search and store the alert results
//   3. grade logged bets and refresh their CLV

interface StateDoc {
  kv?: Record<string, unknown>;
}

interface SavedSearchDoc {
  id: string;
  name: string;
  body: Record<string, unknown>;
  alertMinEv: number;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasStore()) return NextResponse.json({ error: "storage not configured" }, { status: 503 });

  const state = await readDoc<StateDoc>("state", {});
  const kv = state.kv ?? {};
  const board = parseCustomBoard(kv["nfl-price-board"]);
  const adjustments = (Array.isArray(kv["nfl-adjustments"]) ? kv["nfl-adjustments"] : []) as RatingAdjustment[];
  const qbOverrides = (kv["nfl-qb-overrides"] ?? {}) as Record<string, string>;
  const decidedGames = Array.isArray(kv["nfl-decided-games"]) ? (kv["nfl-decided-games"] as never[]) : [];

  const engine = await getEngineView({ adjustments, qbOverrides, decidedGames }, board);

  // 1. Price snapshot (real prices only).
  const prices: Record<string, { american: number; implied: number }> = {};
  for (const l of engine.legs) {
    if (l.source === "sample") continue;
    prices[l.id] = { american: l.americanOdds, implied: l.impliedProb };
  }
  const snapshot = { ts: Date.now(), count: Object.keys(prices).length, prices };
  await writeDoc("odds-latest", snapshot);
  const history = await readDoc<{ ts: number; count: number }[]>("odds-history-index", []);
  history.push({ ts: snapshot.ts, count: snapshot.count });
  await writeDoc("odds-history-index", history.slice(-90));
  await writeDoc(`snapshots/odds-${new Date(snapshot.ts).toISOString().slice(0, 10)}`, snapshot);

  // 2. Saved-search alert sweep.
  const searches = (Array.isArray(kv["nfl-saved-searches"]) ? kv["nfl-saved-searches"] : []) as SavedSearchDoc[];
  const items = [];
  for (const s of searches.slice(0, 20)) {
    try {
      const params = { ...(s.body as Partial<SearchParams>), limit: 5 };
      const result = search(engine.sim, engine.legs, normalize(params));
      const top = result.parlays[0];
      items.push({
        id: s.id,
        name: s.name,
        count: result.parlays.length,
        topEv: top?.evAnchored ?? null,
        triggered: top != null && (top.evAnchored ?? -1) >= (s.alertMinEv ?? 0.1),
      });
    } catch {
      items.push({ id: s.id, name: s.name, count: 0, topEv: null, triggered: false });
    }
  }
  await writeDoc("alerts", { at: Date.now(), items });

  // 3. Grade bets + CLV.
  const bets = await loadBets();
  const graded = await gradeBets(bets);
  const clvChanged = await refreshClv(bets, board).catch(() => false);

  return NextResponse.json({
    ok: true,
    snapshotPrices: snapshot.count,
    searchesRun: items.length,
    alertsTriggered: items.filter((i) => i.triggered).length,
    betsGraded: graded,
    clvUpdated: clvChanged,
  });
}

// Mirror of the /api/search parameter defaults, minus request plumbing.
import type { MarketType, SortObjective } from "@/lib/engine/types";
const ALL_MARKETS: MarketType[] = ["division", "playoffs", "conference", "superbowl", "winsOver", "winsUnder"];
function normalize(p: Partial<SearchParams> & Record<string, unknown>): SearchParams {
  const minLegs = Math.min(8, Math.max(2, Math.round(Number(p.minLegs) || 2)));
  return {
    minLegs,
    maxLegs: Math.max(minLegs, Math.min(8, Math.round(Number(p.maxLegs) || 3))),
    markets: Array.isArray(p.markets) && p.markets.length ? (p.markets as MarketType[]) : ALL_MARKETS,
    includeTeams: (p.includeTeams as string[]) ?? [],
    excludeTeams: (p.excludeTeams as string[]) ?? [],
    maxLegsPerTeam: Number(p.maxLegsPerTeam) || 1,
    minWinProb: Number(p.minWinProb) || 0,
    minEv: Number.isFinite(Number(p.minEv)) ? Number(p.minEv) : 0,
    minPayoutAmerican: p.minPayoutAmerican ? Number(p.minPayoutAmerican) : null,
    maxPayoutAmerican: p.maxPayoutAmerican ? Number(p.maxPayoutAmerican) : null,
    allowCorrelated: Boolean(p.allowCorrelated),
    anchorWeight: Number.isFinite(Number(p.anchorWeight)) ? Number(p.anchorWeight) : 0.3,
    maxDivergence: p.maxDivergence == null ? null : Number(p.maxDivergence),
    requireLineShopEdge: Boolean(p.requireLineShopEdge),
    sortBy: (p.sortBy as SortObjective) ?? "value",
    limit: 5,
    bankroll: Number(p.bankroll) || 1000,
    kellyMultiplier: Number(p.kellyMultiplier) || 0.25,
  };
}
