import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine/engineCache";
import { engineInvariants, modelVsMarket } from "@/lib/engine/diagnostics";
import { backtest } from "@/lib/engine/backtest";
import { HISTORY, IS_SYNTHETIC } from "@/lib/data/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Model trust report: engine invariants, model-vs-market agreement, and a
// calibration backtest over historical predictions.
export async function GET() {
  const engine = await getEngine();
  const invariants = engineInvariants(engine.legs, engine.teams);
  const agreement = modelVsMarket(engine.legs);
  const calibration = backtest(HISTORY, 5);

  return NextResponse.json({
    sims: engine.sims,
    invariants,
    invariantsPass: invariants.every((c) => c.ok),
    agreement,
    calibration,
    calibrationIsSynthetic: IS_SYNTHETIC,
  });
}
