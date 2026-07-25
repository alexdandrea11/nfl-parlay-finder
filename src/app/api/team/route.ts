import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine/engineCache";
import { H2H, leagueMean, powerPts, unitsFor } from "@/lib/engine/gameModel";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Team deep dive: the model's full reasoning for one team — projected win
// distribution, P(playoffs | exactly k wins), the division race, unit
// profile vs league, and recent head-to-head vs division rivals (context
// only — deliberately NOT a model input; see gameModel.ts).
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const teamId = String(body.teamId ?? "");
    const options: EngineOptions = {
      adjustments: Array.isArray(body.adjustments) ? (body.adjustments as RatingAdjustment[]) : [],
      decidedGames: Array.isArray(body.decidedGames) ? (body.decidedGames as DecidedGame[]) : [],
      qbOverrides:
        body.qbOverrides && typeof body.qbOverrides === "object"
          ? (body.qbOverrides as Record<string, string>)
          : {},
    };
    const engine = await getEngine(options);
    const { sim } = engine;
    const idx = sim.index[teamId];
    if (idx == null) {
      return NextResponse.json({ error: `unknown team ${teamId}` }, { status: 400 });
    }
    const team = engine.teams.find((t) => t.id === teamId)!;
    const N = sim.N;
    const base = idx * N;

    // Win distribution + playoff/division outcomes conditioned on win count.
    const winCount = new Array<number>(18).fill(0);
    const playoffAtWins = new Array<number>(18).fill(0);
    const divisionAtWins = new Array<number>(18).fill(0);
    let winSum = 0;
    let playoffs = 0;
    let division = 0;
    let conference = 0;
    let superbowl = 0;
    for (let s = 0; s < N; s++) {
      const w = Math.min(17, sim.winCounts[base + s]);
      winCount[w]++;
      winSum += w;
      if (sim.madePlayoffs[base + s]) {
        playoffs++;
        playoffAtWins[w]++;
      }
      if (sim.wonDivision[base + s]) {
        division++;
        divisionAtWins[w]++;
      }
      conference += sim.wonConference[base + s];
      superbowl += sim.wonSuperbowl[base + s];
    }
    const winDist = winCount.map((c, w) => ({
      wins: w,
      p: c / N,
      pPlayoffsGiven: c > 0 ? playoffAtWins[w] / c : null,
      pDivisionGiven: c > 0 ? divisionAtWins[w] / c : null,
    }));

    // Division race: rivals' projections from the same simulations.
    const rivals = engine.teams
      .filter((t) => t.conference === team.conference && t.division === team.division)
      .map((t) => {
        const ri = sim.index[t.id];
        const rBase = ri * N;
        let rWins = 0;
        let rPlayoffs = 0;
        let rDivision = 0;
        for (let s = 0; s < N; s++) {
          rWins += sim.winCounts[rBase + s];
          rPlayoffs += sim.madePlayoffs[rBase + s];
          rDivision += sim.wonDivision[rBase + s];
        }
        return {
          teamId: t.id,
          name: t.name,
          meanWins: rWins / N,
          pPlayoffs: rPlayoffs / N,
          pDivision: rDivision / N,
          power: Math.round(powerPts(t.id) * 10) / 10,
        };
      })
      .sort((a, b) => b.meanWins - a.meanWins);

    // Unit profile vs league.
    const u = unitsFor(teamId);
    const lg = leagueMean();
    const units = {
      passOff: u.passOff,
      rushOff: u.rushOff,
      passDef: u.passDef,
      rushDef: u.rushDef,
      league: lg,
    };

    // Head-to-head vs division rivals (context, not a model input).
    const h2h = Object.entries(H2H[teamId] ?? {}).map(([oppId, games]) => {
      const recent = [...games].sort((a, b) => b.season - a.season || b.week - a.week).slice(0, 6);
      let w = 0;
      let l = 0;
      for (const g of recent) {
        const isHome = g.home === teamId;
        const won = isHome ? g.homeScore > g.awayScore : g.awayScore > g.homeScore;
        if (won) w++;
        else l++;
      }
      return { oppId, wins: w, losses: l, games: recent };
    });

    return NextResponse.json({
      teamId,
      name: team.name,
      conference: team.conference,
      division: team.division,
      sims: N,
      meanWins: winSum / N,
      pPlayoffs: playoffs / N,
      pDivision: division / N,
      pConference: conference / N,
      pSuperbowl: superbowl / N,
      power: Math.round(powerPts(teamId) * 10) / 10,
      winDist,
      rivals,
      units,
      h2h,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "team detail failed" },
      { status: 500 },
    );
  }
}
