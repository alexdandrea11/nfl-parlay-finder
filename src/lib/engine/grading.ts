// Grade logged futures bets from actual results. Each market becomes
// decidable at a different time:
//   winsOver/winsUnder — once that team has played all 17 games
//   division / playoffs — once the regular season is complete
//   conference — once the Super Bowl matchup is set (participants = champs)
//   superbowl — once the Super Bowl has been played
// Final-standings ties use the same H2H → division → conference approximation
// as the simulator (deterministic alphabetical last resort).

import { TEAMS } from "../data/teams";
import type { SeasonResults } from "../data/seasonResults";

export type LegOutcome = "won" | "lost" | "pending";

interface FinalStandings {
  divisionWinners: Set<string>;
  playoffField: Set<string>;
}

function computeStandings(results: SeasonResults): FinalStandings | null {
  if (!results.regComplete) return null;
  const wins: Record<string, number> = {};
  const divWins: Record<string, number> = {};
  const confWins: Record<string, number> = {};
  const confGames: Record<string, number> = {};
  const h2h: Record<string, number> = {}; // "A|B" -> A's net wins vs B
  const teamOf = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
  for (const t of TEAMS) {
    wins[t.id] = 0;
    divWins[t.id] = 0;
    confWins[t.id] = 0;
    confGames[t.id] = 0;
  }
  for (const g of results.reg) {
    const home = teamOf[g.homeId];
    const away = teamOf[g.awayId];
    if (!home || !away) continue;
    wins[g.winnerId] = (wins[g.winnerId] ?? 0) + 1;
    const sameConf = home.conference === away.conference;
    const sameDiv = sameConf && home.division === away.division;
    if (sameConf) {
      confGames[g.homeId]++;
      confGames[g.awayId]++;
      confWins[g.winnerId]++;
      if (sameDiv) divWins[g.winnerId]++;
    }
    const [a, b] = [g.homeId, g.awayId].sort();
    const key = `${a}|${b}`;
    h2h[key] = (h2h[key] ?? 0) + (g.winnerId === a ? 1 : -1);
  }

  const tieCmp = (x: string, y: string): number => {
    const [a, b] = [x, y].sort();
    const net = (h2h[`${a}|${b}`] ?? 0) * (x === a ? 1 : -1); // x's net vs y
    if (net !== 0) return -net;
    const tx = teamOf[x];
    const ty = teamOf[y];
    if (tx.conference === ty.conference && tx.division === ty.division && divWins[x] !== divWins[y])
      return divWins[y] - divWins[x];
    const cx = confWins[x] / Math.max(1, confGames[x]);
    const cy = confWins[y] / Math.max(1, confGames[y]);
    if (cx !== cy) return cy - cx;
    return x.localeCompare(y); // deterministic last resort
  };
  const cmp = (x: string, y: string) => wins[y] - wins[x] || tieCmp(x, y);

  const divisionWinners = new Set<string>();
  const playoffField = new Set<string>();
  for (const conf of ["AFC", "NFC"] as const) {
    const confTeams = TEAMS.filter((t) => t.conference === conf).map((t) => t.id);
    const byDiv = new Map<string, string[]>();
    for (const id of confTeams) {
      const d = teamOf[id].division;
      byDiv.set(d, [...(byDiv.get(d) ?? []), id]);
    }
    const winners: string[] = [];
    for (const ids of byDiv.values()) {
      ids.sort(cmp);
      winners.push(ids[0]);
    }
    for (const w of winners) {
      divisionWinners.add(w);
      playoffField.add(w);
    }
    const rest = confTeams.filter((id) => !divisionWinners.has(id)).sort(cmp);
    for (const id of rest.slice(0, 3)) playoffField.add(id);
  }
  return { divisionWinners, playoffField };
}

/**
 * Outcome of a single futures leg given the season so far.
 * Leg ids: "market:TEAM" or "winsOver:TEAM:10.5".
 */
export function gradeLeg(legId: string, results: SeasonResults): LegOutcome {
  const [market, teamId, lineStr] = legId.split(":");
  const sb = results.post.find((g) => g.gameType === "SB");

  switch (market) {
    case "winsOver":
    case "winsUnder": {
      const played = results.reg.filter((g) => g.homeId === teamId || g.awayId === teamId);
      if (played.length < 17) return "pending";
      const wins = played.filter((g) => g.winnerId === teamId).length;
      const line = Number(lineStr);
      const over = wins > line;
      return (market === "winsOver") === over ? "won" : "lost";
    }
    case "division": {
      const st = computeStandings(results);
      if (!st) return "pending";
      return st.divisionWinners.has(teamId) ? "won" : "lost";
    }
    case "playoffs": {
      const st = computeStandings(results);
      if (!st) return "pending";
      return st.playoffField.has(teamId) ? "won" : "lost";
    }
    case "conference": {
      // Conference champs = winners of the two conference-championship games.
      const conGames = results.post.filter((g) => g.gameType === "CON");
      if (conGames.some((g) => g.winnerId === teamId)) return "won";
      if (conGames.length >= 2) return "lost";
      return "pending";
    }
    case "superbowl": {
      if (!sb) return "pending"; // only played games appear in results
      return sb.winnerId === teamId ? "won" : "lost";
    }
    default:
      return "pending";
  }
}
