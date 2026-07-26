// Player prop projections backed out of the game model: team expected
// points → team volume → player usage shares → player lines. All from the
// same simulation-consistent chain, so SGP correlations are real.

import model from "../data/generated/team-model.json";
import { expectedPoints, leagueMean, unitsFor, type UnitProfile } from "./gameModel";

export interface PlayerRates {
  id: string;
  name: string;
  pos: string;
  team: string;
  g: number;
  depth: number | null;
  passAtt: number;
  passYds: number;
  passTds: number;
  carries: number;
  rushYds: number;
  targets: number;
  rec: number;
  recYds: number;
  recTds: number;
}

const PLAYERS = (model as unknown as {
  players: { byTeam: Record<string, PlayerRates[]>; teamPerGame: Record<string, { passYds: number; rushYds: number; passAtt: number; carries: number }> };
}).players;

export interface PlayerProjection {
  id: string;
  name: string;
  pos: string;
  team: string;
  projPassYds: number | null;
  projRushYds: number | null;
  projRecYds: number | null;
  projRec: number | null;
}

/**
 * Project both teams' players for one matchup. Team volume scales with the
 * model's expected score and the opponent's unit quality; player numbers are
 * usage shares of that volume.
 */
export function projectGame(
  homeId: string,
  awayId: string,
  units?: Record<string, UnitProfile> | null,
): { muHome: number; muAway: number; players: PlayerProjection[] } {
  const muHome = expectedPoints(homeId, awayId, units) + 0.82;
  const muAway = expectedPoints(awayId, homeId, units) - 0.82;
  const lg = leagueMean();

  const projectTeam = (teamId: string, oppId: string, muPts: number): PlayerProjection[] => {
    const roster = PLAYERS.byTeam[teamId] ?? [];
    const teamPg = PLAYERS.teamPerGame[teamId];
    if (!teamPg) return [];
    const opp = units?.[oppId] ?? unitsFor(oppId);
    // Scoring factor (modest) + opponent unit factor (EPA/play → volume-ish).
    const scoreF = 0.55 + 0.45 * (muPts / 22.6);
    const passDefF = Math.min(1.22, Math.max(0.78, 1 + 1.8 * (opp.passDef - lg.passDef)));
    const rushDefF = Math.min(1.22, Math.max(0.78, 1 + 2.2 * (opp.rushDef - lg.rushDef)));
    const teamPass = teamPg.passYds * scoreF * passDefF;
    const teamRush = teamPg.rushYds * scoreF * rushDefF;
    // QB1 = the depth chart's #1 QB when known; else the volume leader.
    const qbs = roster.filter((p) => p.pos === "QB");
    const qb1 =
      qbs.find((p) => p.depth === 1) ??
      qbs.reduce((a, b) => (b.passAtt > (a?.passAtt ?? 0) ? b : a), qbs[0]);
    // Depth-chart damping: buried players lose usage vs their historical rates.
    const depthF = (p: PlayerRates) =>
      p.depth == null ? 0.85 : p.depth === 1 ? 1.0 : p.depth === 2 ? 0.85 : p.depth === 3 ? 0.55 : 0.3;
    return roster.map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.pos,
      team: teamId,
      projPassYds:
        p.id === qb1?.id && p.passYds > 30
          ? Math.round((teamPass * Math.min(1, p.passYds / Math.max(1, teamPg.passYds) + 0.12)))
          : null,
      projRushYds:
        p.rushYds > 8 ? Math.round((p.rushYds / teamPg.rushYds) * teamRush * depthF(p) * 10) / 10 : null,
      projRecYds:
        p.recYds > 8 ? Math.round((p.recYds / teamPg.passYds) * teamPass * depthF(p) * 10) / 10 : null,
      projRec: p.rec > 1 ? Math.round(p.rec * scoreF * passDefF * depthF(p) * 10) / 10 : null,
    }));
  };

  return {
    muHome,
    muAway,
    players: [...projectTeam(homeId, awayId, muHome), ...projectTeam(awayId, homeId, muAway)],
  };
}

/** Rough per-stat volatility for prop probability (Normal approximation). */
export function propSd(statMean: number, stat: "pass" | "rush" | "rec" | "receptions"): number {
  if (stat === "receptions") return Math.max(1.3, statMean * 0.35);
  const ratio = stat === "pass" ? 0.28 : stat === "rush" ? 0.45 : 0.48;
  return Math.max(12, statMean * ratio);
}
