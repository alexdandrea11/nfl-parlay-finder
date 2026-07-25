import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine/engineCache";
import { MODEL_META, powerPts, QBS, QB_STARTERS, SCHEDULE } from "@/lib/engine/gameModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const engine = await getEngine();
  const teams = engine.teams
    .map((t) => ({
      id: t.id,
      name: t.name,
      conference: t.conference,
      division: t.division,
      // Expected margin vs an average team on a neutral field (points).
      rating: Math.round(powerPts(t.id, engine.units) * 10) / 10,
    }))
    .sort((a, b) => b.rating - a.rating);

  const board = engine.legs
    .filter((l) => l.market === "superbowl")
    .map((l) => ({
      teamId: l.teamId,
      teamName: l.teamName,
      modelProb: l.modelProb,
      marketProb: l.marketProb,
      americanOdds: l.americanOdds,
      bestBook: l.bestBook,
      bestAmerican: l.bestAmerican,
      edge: l.legEv,
      divergence: l.divergence,
      live: l.live,
    }))
    .sort((a, b) => b.modelProb - a.modelProb);

  // Books actually present in the data (live feed books vary).
  const bookSet = new Set<string>();
  for (const l of engine.legs) for (const b of l.books) bookSet.add(b.book);

  return NextResponse.json({
    teams,
    board,
    books: [...bookSet],
    sims: engine.sims,
    oddsMeta: engine.oddsMeta,
    modelMeta: MODEL_META,
    freshness: engine.freshness,
    qbs: QBS,
    qbStarters: QB_STARTERS,
    schedule: SCHEDULE,
  });
}
