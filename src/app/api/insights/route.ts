import { NextResponse } from "next/server";
import { readDoc } from "@/lib/data/store";
import { buildLegBitset, countBits, andBitset } from "@/lib/engine/bitset";
import { parseCustomBoard } from "@/lib/engine/customBoard";
import { getEngineView } from "@/lib/engine/engineCache";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Insights bundle: playoff seeding matrix, leg-correlation heatmap, and the
// model-probability timeline captured by the daily cron.

const CORR_LEGS = 26; // top legs by |EV| in the correlation matrix

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
    const engine = await getEngineView(options, parseCustomBoard(body.customBoard));
    const { sim } = engine;
    const N = sim.N;

    // --- Seeding matrix: P(team lands seed k) per conference.
    const seeding = engine.teams
      .map((t) => {
        const idx = sim.index[t.id];
        const seeds = Array.from({ length: 7 }, (_, k) => sim.seedCounts[idx * 7 + k] / N);
        return {
          id: t.id,
          name: t.name,
          conference: t.conference,
          pPlayoffs: seeds.reduce((a, b) => a + b, 0),
          seeds,
        };
      })
      .sort((a, b) => b.pPlayoffs - a.pPlayoffs);

    // --- Correlation matrix over the most interesting legs.
    const top = [...engine.legs]
      .filter((l) => l.modelProb > 0.03 && l.modelProb < 0.97)
      .sort((a, b) => Math.abs(b.legEv) - Math.abs(a.legEv))
      .slice(0, CORR_LEGS);
    const bitsets = top.map((l) => buildLegBitset(sim, l));
    const probs = top.map((l) => l.modelProb);
    const matrix: number[][] = [];
    for (let i = 0; i < top.length; i++) {
      const row: number[] = [];
      for (let j = 0; j < top.length; j++) {
        if (i === j) {
          row.push(1);
          continue;
        }
        if (j < i) {
          row.push(matrix[j][i]);
          continue;
        }
        const joint = countBits(andBitset(bitsets[i], bitsets[j])) / N;
        const denom = Math.sqrt(
          probs[i] * (1 - probs[i]) * probs[j] * (1 - probs[j]),
        );
        row.push(denom > 0 ? (joint - probs[i] * probs[j]) / denom : 0);
      }
      matrix.push(row);
    }
    const correlations = {
      legs: top.map((l) => ({ id: l.id, label: l.label, market: l.market, ev: l.legEv, source: l.source })),
      matrix: matrix.map((row) => row.map((v) => Math.round(v * 1000) / 1000)),
    };

    // --- Model-probability timeline (captured daily by the cron).
    const history = await readDoc<{ ts: number; teams: Record<string, unknown> }[]>(
      "model-history",
      [],
    );

    return NextResponse.json({ seeding, correlations, history, sims: N });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "insights failed" },
      { status: 500 },
    );
  }
}
