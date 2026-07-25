import {
  americanToDecimal,
  americanToImplied,
  expectedValue,
} from "./odds";
import type { SimResult } from "./simulate";
import type { BookPrice, Conference, DivisionName, Leg, MarketType, Team } from "./types";

const MARKET_LABEL: Record<MarketType, string> = {
  division: "Division Winner",
  playoffs: "Make Playoffs",
  conference: "Conference Champion",
  superbowl: "Super Bowl Champion",
  winsOver: "Regular-Season Wins Over",
  winsUnder: "Regular-Season Wins Under",
};

export interface LegMeta {
  id: string;
  market: MarketType;
  teamId: string;
  teamName: string;
  teamIndex: number;
  conference: Conference;
  division: DivisionName;
  label: string;
  line?: number;
  modelProb: number;
}

function boolProb(arr: Uint8Array, teamIndex: number, N: number): number {
  let c = 0;
  const base = teamIndex * N;
  for (let s = 0; s < N; s++) c += arr[base + s];
  return c / N;
}

function meanWins(sim: SimResult, teamIndex: number): number {
  let sum = 0;
  const base = teamIndex * sim.N;
  for (let s = 0; s < sim.N; s++) sum += sim.winCounts[base + s];
  return sum / sim.N;
}

function overProb(sim: SimResult, teamIndex: number, line: number): number {
  let c = 0;
  const base = teamIndex * sim.N;
  for (let s = 0; s < sim.N; s++) if (sim.winCounts[base + s] > line) c++;
  return c / sim.N;
}

/** Win-total lines are a property of the market — fix them from the base sim. */
export function computeWinLines(sim: SimResult, teams: Team[]): Record<string, number> {
  const lines: Record<string, number> = {};
  teams.forEach((t, i) => {
    lines[t.id] = Math.floor(meanWins(sim, i)) + 0.5;
  });
  return lines;
}

/** Build every candidate leg with its model probability from the sim. */
export function enumerateLegs(
  sim: SimResult,
  teams: Team[],
  lines: Record<string, number>,
): LegMeta[] {
  const legs: LegMeta[] = [];
  teams.forEach((team, i) => {
    const common = {
      teamId: team.id,
      teamName: team.name,
      teamIndex: i,
      conference: team.conference,
      division: team.division,
    };
    legs.push({
      ...common,
      id: `division:${team.id}`,
      market: "division",
      label: `${team.name} win ${team.conference} ${team.division}`,
      modelProb: boolProb(sim.wonDivision, i, sim.N),
    });
    legs.push({
      ...common,
      id: `playoffs:${team.id}`,
      market: "playoffs",
      label: `${team.name} make playoffs`,
      modelProb: boolProb(sim.madePlayoffs, i, sim.N),
    });
    legs.push({
      ...common,
      id: `conference:${team.id}`,
      market: "conference",
      label: `${team.name} win conference`,
      modelProb: boolProb(sim.wonConference, i, sim.N),
    });
    legs.push({
      ...common,
      id: `superbowl:${team.id}`,
      market: "superbowl",
      label: `${team.name} win Super Bowl`,
      modelProb: boolProb(sim.wonSuperbowl, i, sim.N),
    });
    const line = lines[team.id];
    const over = overProb(sim, i, line);
    legs.push({
      ...common,
      id: `winsOver:${team.id}:${line}`,
      market: "winsOver",
      label: `${team.name} OVER ${line} wins`,
      line,
      modelProb: over,
    });
    legs.push({
      ...common,
      id: `winsUnder:${team.id}:${line}`,
      market: "winsUnder",
      label: `${team.name} UNDER ${line} wins`,
      line,
      modelProb: 1 - over,
    });
  });
  return legs;
}

/** Average implied probability across a leg's books. */
function avgImplied(prices: BookPrice[]): number {
  if (!prices.length) return 0;
  let s = 0;
  for (const p of prices) s += americanToImplied(p.american);
  return s / prices.length;
}

/**
 * Vig-removed market-consensus probability for every leg, using the correct
 * normalization per market:
 *   superbowl → all 32 teams sum to 1
 *   conference → each conference sums to 1
 *   division → each division sums to 1
 *   playoffs → each conference sums to 7 (7 seeds make it)
 *   wins over/under → each team's pair sums to 1
 * Returns a map legId -> consensus probability. Independent of the model, so
 * it is computed once from the (fixed) odds and reused across variant sims.
 */
export function computeConsensus(
  metas: LegMeta[],
  oddsMap: Map<string, BookPrice[]>,
): Map<string, number> {
  const raw = new Map<string, number>();
  for (const m of metas) raw.set(m.id, avgImplied(oddsMap.get(m.id) ?? []));

  const out = new Map<string, number>();
  const normalizeGroup = (group: LegMeta[], target: number) => {
    const sum = group.reduce((a, m) => a + (raw.get(m.id) ?? 0), 0);
    for (const m of group) {
      const r = raw.get(m.id) ?? 0;
      out.set(m.id, sum > 0 ? (r / sum) * target : r);
    }
  };

  const groupBy = (pred: (m: LegMeta) => boolean, keyFn: (m: LegMeta) => string) => {
    const groups = new Map<string, LegMeta[]>();
    for (const m of metas) {
      if (!pred(m)) continue;
      const k = keyFn(m);
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(m);
    }
    return groups;
  };

  groupBy((m) => m.market === "superbowl", () => "sb").forEach((g) => normalizeGroup(g, 1));
  groupBy((m) => m.market === "conference", (m) => m.conference).forEach((g) => normalizeGroup(g, 1));
  groupBy((m) => m.market === "division", (m) => `${m.conference}:${m.division}`).forEach((g) => normalizeGroup(g, 1));
  groupBy((m) => m.market === "playoffs", (m) => m.conference).forEach((g) => normalizeGroup(g, 7));
  groupBy(
    (m) => m.market === "winsOver" || m.market === "winsUnder",
    (m) => m.teamId,
  ).forEach((g) => normalizeGroup(g, 1));

  return out;
}

/** Assemble final legs: fixed book odds + fixed consensus + this sim's model. */
export function assembleLegs(
  metas: LegMeta[],
  oddsMap: Map<string, BookPrice[]>,
  consensus: Map<string, number>,
  liveIds: Set<string> = new Set(),
  customIds: Set<string> = new Set(),
): Leg[] {
  return metas.map((m) => {
    const books = oddsMap.get(m.id) ?? [];
    const fd = books.find((b) => b.book === "fanduel") ?? books[0];
    const fdAmerican = fd?.american ?? 1000;
    const fdDecimal = fd?.decimal ?? americanToDecimal(fdAmerican);
    const best = books.reduce(
      (acc, b) => (b.decimal > acc.decimal ? b : acc),
      fd ?? { book: "fanduel", american: fdAmerican, decimal: fdDecimal },
    );
    const marketProb = consensus.get(m.id) ?? americanToImplied(fdAmerican);
    return {
      id: m.id,
      market: m.market,
      marketLabel: MARKET_LABEL[m.market],
      teamId: m.teamId,
      teamName: m.teamName,
      label: m.label,
      line: m.line,
      americanOdds: fdAmerican,
      decimalOdds: fdDecimal,
      impliedProb: americanToImplied(fdAmerican),
      books,
      source: customIds.has(m.id) ? "custom" : liveIds.has(m.id) ? "live" : "sample",
      live: liveIds.has(m.id),
      bestBook: best.book,
      bestAmerican: best.american,
      bestDecimal: best.decimal,
      marketProb,
      modelProb: m.modelProb,
      divergence: m.modelProb - marketProb,
      legEv: expectedValue(fdDecimal, m.modelProb),
      simIndex: m.teamIndex,
    };
  });
}

export { MARKET_LABEL };
