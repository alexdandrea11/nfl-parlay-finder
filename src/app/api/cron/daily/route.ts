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

  // 1b. Model-probability timeline point (feeds the Insights chart).
  {
    const { sim } = engine;
    const N = sim.N;
    const teams: Record<string, { w: number; po: number; dv: number; sb: number }> = {};
    for (const t of engine.teams) {
      const base = sim.index[t.id] * N;
      let w = 0;
      let po = 0;
      let dv = 0;
      let sb = 0;
      for (let s = 0; s < N; s++) {
        w += sim.winCounts[base + s];
        po += sim.madePlayoffs[base + s];
        dv += sim.wonDivision[base + s];
        sb += sim.wonSuperbowl[base + s];
      }
      teams[t.id] = {
        w: Math.round((w / N) * 100) / 100,
        po: Math.round((po / N) * 1000) / 1000,
        dv: Math.round((dv / N) * 1000) / 1000,
        sb: Math.round((sb / N) * 1000) / 1000,
      };
    }
    const mh = await readDoc<{ ts: number }[]>("model-history", []);
    mh.push({ ts: Date.now(), teams } as never);
    await writeDoc("model-history", mh.slice(-250));
  }

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

  // 4. Digest: one readable summary of everything the machine did, stored
  // for the UI and optionally pushed to the phone via ntfy.sh (set NTFY_TOPIC).
  {
    const mh = await readDoc<{ ts: number; teams: Record<string, { po: number; sb: number }> }[]>(
      "model-history",
      [],
    );
    const movers: string[] = [];
    if (mh.length >= 2) {
      const prev = mh[mh.length - 2].teams;
      const cur = mh[mh.length - 1].teams;
      Object.keys(cur)
        .map((id) => ({ id, d: (cur[id]?.po ?? 0) - (prev[id]?.po ?? 0) }))
        .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
        .slice(0, 3)
        .filter((m) => Math.abs(m.d) > 0.005)
        .forEach((m) => movers.push(`${m.id} playoffs ${m.d > 0 ? "+" : ""}${(m.d * 100).toFixed(1)}pp`));
    }
    const open = bets.filter((b) => b.status === "open").length;
    const won = bets.filter((b) => b.status === "won").length;
    const lost = bets.filter((b) => b.status === "lost").length;
    const triggered = items.filter((i) => i.triggered);
    const lines = [
      movers.length ? `Movers: ${movers.join(", ")}` : "No big model moves.",
      `Alerts: ${triggered.length ? triggered.map((t) => `${t.name} (top EV ${Math.round((t.topEv ?? 0) * 100)}%)`).join(", ") : "none triggered"}`,
      `Bets: ${open} open, ${won}W-${lost}L`,
      `Prices snapshotted: ${snapshot.count}`,
    ];
    const digest = { at: Date.now(), lines };
    await writeDoc("digest", digest);
    const topic = process.env.NTFY_TOPIC;
    if (topic) {
      await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: { Title: "ParlayEdge daily brief" },
        body: lines.join("\n"),
      }).catch(() => {});
    }
  }

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
