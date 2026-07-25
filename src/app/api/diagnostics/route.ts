import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine/engineCache";
import { engineInvariants, modelVsMarket } from "@/lib/engine/diagnostics";
import { backtest, type Prediction } from "@/lib/engine/backtest";
import { loadBets } from "@/lib/engine/betService";
import { HISTORY, IS_SYNTHETIC } from "@/lib/data/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Model trust report: engine invariants, model-vs-market agreement, and a
// calibration backtest. Once enough logged bet legs have been graded, the
// calibration switches from labeled synthetic data to YOUR real record.
const MIN_REAL_LEGS = 10;

export async function GET() {
  const engine = await getEngine();
  const invariants = engineInvariants(engine.legs, engine.teams);
  const agreement = modelVsMarket(engine.legs);

  const bets = await loadBets().catch(() => []);
  const realPredictions: Prediction[] = [];
  for (const bet of bets) {
    for (const leg of bet.legs) {
      if (leg.outcome === "won" || leg.outcome === "lost") {
        realPredictions.push({
          label: leg.label,
          prob: leg.modelProb,
          hit: leg.outcome === "won",
        });
      }
    }
  }
  const useReal = realPredictions.length >= MIN_REAL_LEGS;
  const calibration = backtest(useReal ? realPredictions : HISTORY, 5);

  return NextResponse.json({
    sims: engine.sims,
    invariants,
    invariantsPass: invariants.every((c) => c.ok),
    agreement,
    calibration,
    calibrationIsSynthetic: useReal ? false : IS_SYNTHETIC,
    realGradedLegs: realPredictions.length,
  });
}
