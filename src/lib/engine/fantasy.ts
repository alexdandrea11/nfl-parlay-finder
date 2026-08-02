// Fantasy layer: season-long projections built from the SAME chain as the
// betting model — team expected points/volume per real scheduled matchup →
// player usage shares (depth-chart damped) → per-game stats → fantasy points.
// Strength-of-schedule is inherent: every game is priced against the actual
// opponent's units.

import model from "../data/generated/team-model.json";
import { expectedPoints, leagueMean, SCHEDULE, unitsFor, type UnitProfile } from "./gameModel";
import type { PlayerRates } from "./props";

const PLAYERS = (model as unknown as {
  players: {
    byTeam: Record<string, (PlayerRates & { passTds: number; rushTds: number; recTds: number })[]>;
    teamPerGame: Record<string, { passYds: number; rushYds: number; passAtt: number; carries: number }>;
  };
}).players;

export type Scoring = "ppr" | "half" | "std";

export interface FantasyRow {
  id: string;
  name: string;
  pos: string;
  team: string;
  depth: number | null;
  ppg: number;
  season: number;
  vorp: number;
  posRank: number;
}

const REPLACEMENT_RANK: Record<string, number> = { QB: 13, RB: 25, WR: 25, TE: 13 };

function depthF(depth: number | null): number {
  return depth == null ? 0.85 : depth === 1 ? 1.0 : depth === 2 ? 0.85 : depth === 3 ? 0.55 : 0.3;
}

/**
 * Season fantasy projections for every rostered skill player, scored per the
 * chosen format. Returns rows sorted by season points with VORP computed
 * against 12-team replacement levels.
 */
export function fantasyProjections(
  scoring: Scoring,
  units?: Record<string, UnitProfile> | null,
): FantasyRow[] {
  const lg = leagueMean();
  const recPt = scoring === "ppr" ? 1 : scoring === "half" ? 0.5 : 0;

  // Precompute each team's per-game volume factors across its real schedule.
  const teamGames = new Map<string, { passF: number; rushF: number }[]>();
  for (const g of SCHEDULE) {
    for (const [teamId, oppId, home] of [
      [g.home, g.away, true],
      [g.away, g.home, false],
    ] as [string, string, boolean][]) {
      const mu = expectedPoints(teamId, oppId, units) + (home ? 0.82 : -0.82);
      const opp = units?.[oppId] ?? unitsFor(oppId);
      const scoreF = 0.55 + 0.45 * (mu / 22.6);
      const passF = scoreF * Math.min(1.22, Math.max(0.78, 1 + 1.8 * (opp.passDef - lg.passDef)));
      const rushF = scoreF * Math.min(1.22, Math.max(0.78, 1 + 2.2 * (opp.rushDef - lg.rushDef)));
      const arr = teamGames.get(teamId) ?? [];
      arr.push({ passF, rushF });
      teamGames.set(teamId, arr);
    }
  }

  const rows: FantasyRow[] = [];
  for (const [teamId, roster] of Object.entries(PLAYERS.byTeam)) {
    const games = teamGames.get(teamId) ?? [];
    const qbs = roster.filter((p) => p.pos === "QB");
    const qb1 =
      qbs.find((p) => p.depth === 1) ??
      qbs.reduce((a, b) => (b.passAtt > (a?.passAtt ?? 0) ? b : a), qbs[0]);
    for (const p of roster) {
      const df = depthF(p.depth);
      const isQb1 = p.id === qb1?.id;
      let season = 0;
      for (const f of games) {
        const passYds = isQb1 ? p.passYds * f.passF : 0;
        const passTds = isQb1 ? p.passTds * f.passF : 0;
        const rushYds = p.rushYds * f.rushF * (p.pos === "QB" ? (isQb1 ? 1 : 0) : df);
        const rushTds = (p.rushTds ?? 0) * f.rushF * (p.pos === "QB" ? (isQb1 ? 1 : 0) : df);
        const rec = p.rec * f.passF * df;
        const recYds = p.recYds * f.passF * df;
        const recTds = (p.recTds ?? 0) * f.passF * df;
        season +=
          passYds * 0.04 +
          passTds * 4 +
          rushYds * 0.1 +
          rushTds * 6 +
          rec * recPt +
          recYds * 0.1 +
          recTds * 6;
      }
      if (season < 20) continue;
      rows.push({
        id: p.id,
        name: p.name,
        pos: p.pos,
        team: teamId,
        depth: p.depth,
        ppg: Math.round((season / Math.max(1, games.length)) * 10) / 10,
        season: Math.round(season),
        vorp: 0,
        posRank: 0,
      });
    }
  }

  rows.sort((a, b) => b.season - a.season);
  // Position ranks + VORP vs replacement.
  const byPos = new Map<string, FantasyRow[]>();
  for (const r of rows) {
    const list = byPos.get(r.pos) ?? [];
    list.push(r);
    byPos.set(r.pos, list);
    r.posRank = list.length;
  }
  for (const [pos, list] of byPos) {
    const repl = list[Math.min(list.length - 1, (REPLACEMENT_RANK[pos] ?? 20) - 1)]?.season ?? 0;
    for (const r of list) r.vorp = Math.round(r.season - repl);
  }
  return rows;
}

export interface DraftPick {
  round: number;
  overall: number;
  suggestions: (FantasyRow & { note: string })[];
}

/**
 * Snake-draft assistant: assumes the room drafts roughly by overall value
 * (our board as the ADP proxy), and at each of YOUR picks suggests the top
 * options by VORP with a light positional-need tilt.
 */
export function draftPlan(
  rows: FantasyRow[],
  slot: number,
  teams: number,
  rounds: number,
): DraftPick[] {
  const board = [...rows].sort((a, b) => b.vorp - a.vorp);
  const myNeeds: Record<string, number> = { QB: 1, RB: 5, WR: 5, TE: 1 };
  const have: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const gone = new Set<string>();
  const picks: DraftPick[] = [];

  let overall = 1;
  for (let round = 1; round <= rounds; round++) {
    const inRound = round % 2 === 1 ? slot : teams - slot + 1;
    for (let posInRound = 1; posInRound <= teams; posInRound++, overall++) {
      const isMine = posInRound === inRound;
      const available = board.filter((r) => !gone.has(r.id));
      if (isMine) {
        const scored = available
          .map((r) => {
            const need = (myNeeds[r.pos] ?? 0) - (have[r.pos] ?? 0);
            const needMult = need > 0 ? 1 : 0.55; // roster spot already full
            const lateQbTax = r.pos === "QB" && round <= 3 ? 0.85 : 1; // 1-QB leagues
            return { r, score: r.vorp * needMult * lateQbTax };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        picks.push({
          round,
          overall,
          suggestions: scored.map((s, i) => ({
            ...s.r,
            note:
              i === 0
                ? "best value"
                : s.r.pos !== scored[0].r.pos
                  ? "position pivot"
                  : "next best",
          })),
        });
        const taken = scored[0]?.r;
        if (taken) {
          gone.add(taken.id);
          have[taken.pos] = (have[taken.pos] ?? 0) + 1;
        }
      } else {
        // The room takes the top of the overall board.
        const next = available[0];
        if (next) gone.add(next.id);
      }
    }
  }
  return picks;
}
