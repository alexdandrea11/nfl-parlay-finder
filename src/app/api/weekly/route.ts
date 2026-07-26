import { NextResponse } from "next/server";
import { getGameLines } from "@/lib/data/gameLines";
import { getEngine } from "@/lib/engine/engineCache";
import {
  buildWinProbMatrices,
  eloToPts,
  probMarginOver,
  qbPassOffDelta,
  restAdjustment,
  SCHEDULE,
} from "@/lib/engine/gameModel";
import { americanToDecimal, probToAmerican } from "@/lib/engine/odds";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Weekly best bets: cross-game ML/spread parlays and 6-point teasers for one
// week's slate. Legs come from different games, so joint probability is a
// clean product — the model's margin distribution prices every leg.

interface WeeklyLeg {
  gameKey: string;
  label: string;
  kind: "ml" | "spread";
  price: number;
  decimal: number;
  prob: number;
  ev: number;
}

// Typical FanDuel 6-point teaser payouts (verify the quote when placing).
const TEASER_PAYOUT: Record<number, number> = { 2: -134, 3: 160, 4: 257 };
const TEASE_PTS = 6;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const wantWeek = body.week == null ? null : Number(body.week);
    const options: EngineOptions = {
      adjustments: Array.isArray(body.adjustments) ? (body.adjustments as RatingAdjustment[]) : [],
      decidedGames: Array.isArray(body.decidedGames) ? (body.decidedGames as DecidedGame[]) : [],
      qbOverrides:
        body.qbOverrides && typeof body.qbOverrides === "object"
          ? (body.qbOverrides as Record<string, string>)
          : {},
    };
    const engine = await getEngine(options);
    const teams = engine.teams;
    const T = teams.length;
    const index = engine.sim.index;

    const adjustPts = new Float64Array(T);
    for (const a of options.adjustments ?? []) {
      const i = index[a.teamId];
      if (i != null) adjustPts[i] += eloToPts(a.delta);
    }
    const passOffDelta = new Float64Array(T);
    for (const [teamId, qbId] of Object.entries(options.qbOverrides ?? {})) {
      const i = index[teamId];
      if (i != null) passOffDelta[i] = qbPassOffDelta(teamId, qbId);
    }
    const { marginHome } = buildWinProbMatrices(teams, adjustPts, passOffDelta, engine.units);
    const schedByPair = new Map(SCHEDULE.map((s) => [`${s.home}|${s.away}`, s]));

    const lines = await getGameLines();
    if (!lines) return NextResponse.json({ weeks: [], week: null, parlays: [], teasers: [], legs: [] });

    // Attach weeks; find the requested (or earliest) week's games.
    const games = lines.games
      .map((g) => ({ ...g, sched: schedByPair.get(`${g.homeId}|${g.awayId}`) }))
      .filter((g) => g.sched);
    const weeks = [...new Set(games.map((g) => g.sched!.week))].sort((a, b) => a - b);
    const week = wantWeek && weeks.includes(wantWeek) ? wantWeek : weeks[0] ?? null;
    const slate = games.filter((g) => g.sched!.week === week);

    // Build the leg pool: best model-vs-price leg(s) per game.
    const legs: WeeklyLeg[] = [];
    const teaserLegs: { gameKey: string; label: string; prob: number }[] = [];
    const matchups: {
      gameKey: string; homeId: string; awayId: string; pHome: number;
      muHome: number; muAway: number; modelLine: number;
      fdSpread: number | null; fdTotal: number | null;
    }[] = [];
    for (const g of slate) {
      const h = index[g.homeId];
      const a = index[g.awayId];
      if (h == null || a == null) continue;
      const margin = marginHome[h * T + a] + restAdjustment(g.sched!.hRest, g.sched!.aRest);
      const pHome = probMarginOver(margin, 0);
      const fd = g.books.find((b) => b.book === "fanduel");
      if (!fd) continue;
      const gameKey = `${g.awayId}@${g.homeId}`;
      // Matchup context: model expected score from league total + margin.
      const LG_TOTAL = 44.8;
      matchups.push({
        gameKey,
        homeId: g.homeId,
        awayId: g.awayId,
        pHome,
        muHome: (LG_TOTAL + margin) / 2,
        muAway: (LG_TOTAL - margin) / 2,
        modelLine: -margin, // home-relative spread the model would set
        fdSpread: fd.spreadHome,
        fdTotal: fd.totalLine,
      });
      const push = (label: string, kind: "ml" | "spread", price: number | null, prob: number) => {
        if (price == null) return;
        const decimal = americanToDecimal(price);
        legs.push({ gameKey, label, kind, price, decimal, prob, ev: prob * decimal - 1 });
      };
      push(`${g.homeId} ML`, "ml", fd.mlHome, pHome);
      push(`${g.awayId} ML`, "ml", fd.mlAway, 1 - pHome);
      if (fd.spreadHome != null) {
        const pCoverH = probMarginOver(margin, -fd.spreadHome);
        push(`${g.homeId} ${fd.spreadHome > 0 ? "+" : ""}${fd.spreadHome}`, "spread", fd.spreadHomePrice, pCoverH);
        push(`${g.awayId} ${-fd.spreadHome > 0 ? "+" : ""}${-fd.spreadHome}`, "spread", fd.spreadAwayPrice, 1 - pCoverH);
        // Teaser candidates: both sides at the teased line.
        const teasedH = fd.spreadHome + TEASE_PTS;
        const pTeaseH = probMarginOver(margin, -teasedH);
        teaserLegs.push({
          gameKey,
          label: `${g.homeId} ${fd.spreadHome > 0 ? "+" : ""}${fd.spreadHome} → ${teasedH > 0 ? "+" : ""}${teasedH}`,
          prob: pTeaseH,
        });
        const teasedA = -fd.spreadHome + TEASE_PTS;
        teaserLegs.push({
          gameKey,
          label: `${g.awayId} ${-fd.spreadHome > 0 ? "+" : ""}${-fd.spreadHome} → ${teasedA > 0 ? "+" : ""}${teasedA}`,
          prob: 1 - probMarginOver(margin, teasedA),
        });
      }
    }

    // Parlays: one leg max per game, bucketed by size so the UI can offer a
    // leg-count picker with ranked options per size.
    const pool = [...legs].sort((a, b) => b.ev - a.ev).slice(0, 14);
    const bySize: Record<number, { legs: string[]; prob: number; american: number; ev: number }[]> = { 2: [], 3: [], 4: [], 5: [] };
    const combo = (chosen: WeeklyLeg[], start: number) => {
      if (chosen.length >= 2) {
        let prob = 1;
        let dec = 1;
        for (const l of chosen) {
          prob *= l.prob;
          dec *= l.decimal;
        }
        bySize[chosen.length].push({
          legs: chosen.map((l) => l.label),
          prob,
          american: probToAmerican(1 / dec),
          ev: prob * dec - 1,
        });
      }
      if (chosen.length >= 5) return;
      for (let i = start; i < pool.length; i++) {
        if (chosen.some((c) => c.gameKey === pool[i].gameKey)) continue;
        combo([...chosen, pool[i]], i + 1);
      }
    };
    combo([], 0);
    for (const k of Object.keys(bySize)) {
      bySize[Number(k)].sort((a, b) => b.ev - a.ev);
      bySize[Number(k)] = bySize[Number(k)].slice(0, 6);
    }

    // Teasers: enumerate combos of the strongest teased legs (one per game),
    // multiple ranked options per team-count.
    teaserLegs.sort((a, b) => b.prob - a.prob);
    const tPool = teaserLegs.slice(0, 10);
    const teaserOptions: Record<number, { legs: string[]; prob: number; payout: number; ev: number }[]> = { 2: [], 3: [], 4: [] };
    const tCombo = (chosen: typeof tPool, start: number) => {
      if (chosen.length >= 2 && chosen.length <= 4) {
        const prob = chosen.reduce((a, l) => a * l.prob, 1);
        const dec = americanToDecimal(TEASER_PAYOUT[chosen.length]);
        teaserOptions[chosen.length].push({
          legs: chosen.map((l) => l.label),
          prob,
          payout: TEASER_PAYOUT[chosen.length],
          ev: prob * dec - 1,
        });
      }
      if (chosen.length >= 4) return;
      for (let i = start; i < tPool.length; i++) {
        if (chosen.some((c) => c.gameKey === tPool[i].gameKey)) continue;
        tCombo([...chosen, tPool[i]], i + 1);
      }
    };
    tCombo([], 0);
    for (const k of Object.keys(teaserOptions)) {
      teaserOptions[Number(k)].sort((a, b) => b.ev - a.ev);
      teaserOptions[Number(k)] = teaserOptions[Number(k)].slice(0, 6);
    }

    return NextResponse.json({
      weeks,
      week,
      matchups: matchups.sort((a, b) => b.pHome * (1 - b.pHome) - a.pHome * (1 - a.pHome)),
      legs: [...legs].sort((a, b) => b.ev - a.ev).slice(0, 12),
      parlaysBySize: bySize,
      teaserOptions,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "weekly failed" },
      { status: 500 },
    );
  }
}
