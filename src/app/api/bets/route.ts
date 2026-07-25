import { NextResponse } from "next/server";
import { hasStore, readDoc } from "@/lib/data/store";
import {
  gradeBets,
  loadBets,
  refreshClv,
  saveBets,
  type LoggedBet,
  type LoggedBetLeg,
} from "@/lib/engine/betService";
import { parseCustomBoard } from "@/lib/engine/customBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StateDoc {
  kv?: Record<string, unknown>;
}

export async function GET() {
  if (!hasStore()) return NextResponse.json({ bets: [], storeMissing: true });
  const bets = await loadBets();
  await gradeBets(bets);
  const state = await readDoc<StateDoc>("state", {});
  const board = parseCustomBoard(state.kv?.["nfl-price-board"]);
  await refreshClv(bets, board).catch(() => {});
  return NextResponse.json({ bets: bets.sort((a, b) => b.placedAt - a.placedAt) });
}

export async function POST(req: Request) {
  try {
    if (!hasStore()) return NextResponse.json({ error: "storage not configured" }, { status: 503 });
    const body = (await req.json()) as Record<string, unknown>;
    const legs = (Array.isArray(body.legs) ? body.legs : []) as LoggedBetLeg[];
    if (legs.length === 0) return NextResponse.json({ error: "no legs" }, { status: 400 });
    const bet: LoggedBet = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      placedAt: Date.now(),
      legs: legs.map((l) => ({
        id: String(l.id),
        label: String(l.label),
        market: String(l.market),
        teamId: String(l.teamId),
        americanOdds: Number(l.americanOdds),
        impliedProb: Number(l.impliedProb),
        modelProb: Number(l.modelProb),
        marketProb: Number(l.marketProb),
      })),
      stake: Math.max(0, Number(body.stake) || 0),
      priceAmerican: Number(body.priceAmerican) || 0,
      jointProb: Number(body.jointProb) || 0,
      anchoredProb: Number(body.anchoredProb) || 0,
      anchorWeight: Number(body.anchorWeight) || 0,
      status: "open",
    };
    const bets = await loadBets();
    bets.push(bet);
    await saveBets(bets);
    return NextResponse.json({ ok: true, id: bet.id, count: bets.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "log failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const bets = await loadBets();
  const next = bets.filter((b) => b.id !== id);
  await saveBets(next);
  return NextResponse.json({ ok: true, count: next.length });
}
