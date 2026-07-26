import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine/engineCache";
import { eloToPts, expectedPoints, qbPassOffDelta } from "@/lib/engine/gameModel";
import { probToAmerican } from "@/lib/engine/odds";
import { mulberry32 } from "@/lib/engine/random";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same-game parlay pricing: joint probability of ML/spread/total combos
// within one game, from a Monte Carlo over the model's score distribution.
// Books charge fat margins on SGPs precisely because correlations are hard
// to price — this prices them.

interface Component {
  type: "ml" | "spread" | "total";
  side: "home" | "away" | "over" | "under";
  line?: number; // spread (home-relative) or total
}

const PTS_SD = 9.5; // per-team score SD → margin/total SD ≈ 13.4

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const homeId = String(body.homeId ?? "");
    const awayId = String(body.awayId ?? "");
    const components = (Array.isArray(body.components) ? body.components : []) as Component[];
    const quoted = body.quotedAmerican == null ? null : Number(body.quotedAmerican);
    if (!homeId || !awayId || components.length === 0) {
      return NextResponse.json({ error: "homeId, awayId, components required" }, { status: 400 });
    }
    const options: EngineOptions = {
      adjustments: Array.isArray(body.adjustments) ? (body.adjustments as RatingAdjustment[]) : [],
      decidedGames: Array.isArray(body.decidedGames) ? (body.decidedGames as DecidedGame[]) : [],
      qbOverrides:
        body.qbOverrides && typeof body.qbOverrides === "object"
          ? (body.qbOverrides as Record<string, string>)
          : {},
    };
    const engine = await getEngine(options);
    const index = engine.sim.index;
    if (index[homeId] == null || index[awayId] == null) {
      return NextResponse.json({ error: "unknown team" }, { status: 400 });
    }

    // Expected scores with the user's adjustments (points + QB effects on
    // margin split evenly across the team's expected score).
    const adj = new Map<string, number>();
    for (const a of options.adjustments ?? []) {
      adj.set(a.teamId, (adj.get(a.teamId) ?? 0) + eloToPts(a.delta));
    }
    for (const [teamId, qbId] of Object.entries(options.qbOverrides ?? {})) {
      adj.set(teamId, (adj.get(teamId) ?? 0) + qbPassOffDelta(teamId, qbId) * 35);
    }
    const HFA_SPLIT = 0.82; // ~1.65 pts of home field, half to each side
    const muHome = expectedPoints(homeId, awayId, engine.units) + (adj.get(homeId) ?? 0) + HFA_SPLIT;
    const muAway = expectedPoints(awayId, homeId, engine.units) + (adj.get(awayId) ?? 0) - HFA_SPLIT;

    // Monte Carlo over (homeScore, awayScore).
    const N = 50000;
    const rnd = mulberry32(777);
    const gauss = () => {
      const u = Math.max(1e-12, rnd());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
    };
    let hit = 0;
    const singles = new Array(components.length).fill(0);
    for (let s = 0; s < N; s++) {
      const hs = muHome + gauss() * PTS_SD;
      const as = muAway + gauss() * PTS_SD;
      let all = true;
      components.forEach((c, i) => {
        let ok: boolean;
        if (c.type === "ml") ok = c.side === "home" ? hs > as : as > hs;
        else if (c.type === "spread") {
          const line = c.line ?? 0; // home-relative, e.g. -4.5
          ok = c.side === "home" ? hs + line > as : as - line > hs;
        } else {
          const line = c.line ?? 44.5;
          ok = c.side === "over" ? hs + as > line : hs + as < line;
        }
        if (ok) singles[i]++;
        else all = false;
      });
      if (all) hit++;
    }
    const jointProb = hit / N;
    const independentProb = singles.reduce((a, c) => a * (c / N), 1);
    const quotedDec = quoted ? (quoted > 0 ? 1 + quoted / 100 : 1 + 100 / -quoted) : null;

    return NextResponse.json({
      muHome: Math.round(muHome * 10) / 10,
      muAway: Math.round(muAway * 10) / 10,
      jointProb,
      independentProb,
      correlation: independentProb > 0 ? jointProb / independentProb : 1,
      fairAmerican: probToAmerican(jointProb),
      evAtQuote: quotedDec ? jointProb * quotedDec - 1 : null,
      singles: components.map((c, i) => ({ ...c, prob: singles[i] / N })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sgp failed" },
      { status: 500 },
    );
  }
}
