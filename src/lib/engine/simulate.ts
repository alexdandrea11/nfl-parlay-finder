import { buildWinProbMatrices, eloToPts, qbPassOffDelta, SCHEDULE, type UnitProfile } from "./gameModel";
import { mulberry32 } from "./random";
import type { Conference, EngineOptions, Team } from "./types";

export interface SimResult {
  N: number;
  teamIds: string[];
  index: Record<string, number>; // teamId -> row index
  /** Regular-season win count per team per sim: [teamIdx*N + sim]. */
  winCounts: Int16Array;
  wonDivision: Uint8Array;
  madePlayoffs: Uint8Array;
  wonConference: Uint8Array;
  wonSuperbowl: Uint8Array;
}

interface Standing {
  idx: number;
  wins: number;
  tiebreak: number;
  conference: Conference;
  division: string;
}

/**
 * Monte Carlo of the full season: the REAL schedule (from nflverse), game
 * probabilities from the unit-matchup model, then a reseeded 7-seed playoff
 * bracket per conference and the Super Bowl on a neutral field.
 */
export function runSimulation(
  teams: Team[],
  sims: number,
  seed = 20250901,
  options: EngineOptions = {},
  unitsOverride: Record<string, UnitProfile> | null = null,
): SimResult {
  const N = sims;
  const T = teams.length;
  const teamIds = teams.map((t) => t.id);
  const index: Record<string, number> = {};
  teams.forEach((t, i) => (index[t.id] = i));

  // Injury/news sliders: Elo-scale deltas → points on the margin.
  const adjustPts = new Float64Array(T);
  for (const adj of options.adjustments ?? []) {
    const i = index[adj.teamId];
    if (i != null) adjustPts[i] += eloToPts(adj.delta);
  }

  // QB swaps (injury/benching): shift the team's passing offense.
  const passOffDelta = new Float64Array(T);
  for (const [teamId, qbId] of Object.entries(options.qbOverrides ?? {})) {
    const i = index[teamId];
    if (i != null) passOffDelta[i] = qbPassOffDelta(teamId, qbId);
  }

  const { home: pHomeMatrix, neutral: pNeutralMatrix } = buildWinProbMatrices(
    teams,
    adjustPts,
    passOffDelta,
    unitsOverride,
  );

  // Real schedule → per-game home-team win probability, precomputed once.
  const games = SCHEDULE.filter((g) => index[g.home] != null && index[g.away] != null);
  const G = games.length;
  const gHome = new Int32Array(G);
  const gAway = new Int32Array(G);
  const gProb = new Float64Array(G);
  games.forEach((g, gi) => {
    const h = index[g.home];
    const a = index[g.away];
    gHome[gi] = h;
    gAway[gi] = a;
    gProb[gi] = pHomeMatrix[h * T + a];
  });

  // Games already decided (in-season): force the winner. Keyed by the ORDERED
  // (home, away) pair — each NFL pairing hosts at most once per season.
  const decided = new Map<string, number>();
  for (const g of options.decidedGames ?? []) {
    const h = index[g.homeId];
    const a = index[g.awayId];
    const w = index[g.winnerId];
    if (h != null && a != null && w != null) decided.set(`${h}|${a}`, w);
  }
  const gDecided = decided.size
    ? games.map((_, gi) => decided.get(`${gHome[gi]}|${gAway[gi]}`) ?? -1)
    : null;

  const winCounts = new Int16Array(T * N);
  const wonDivision = new Uint8Array(T * N);
  const madePlayoffs = new Uint8Array(T * N);
  const wonConference = new Uint8Array(T * N);
  const wonSuperbowl = new Uint8Array(T * N);

  const rnd = mulberry32(seed);
  const wins = new Int16Array(T);
  const tiebreak = new Float64Array(T);

  for (let s = 0; s < N; s++) {
    wins.fill(0);
    // Regular season.
    for (let gi = 0; gi < G; gi++) {
      if (gDecided) {
        const w = gDecided[gi];
        if (w >= 0) {
          wins[w]++;
          continue;
        }
      }
      if (rnd() < gProb[gi]) wins[gHome[gi]]++;
      else wins[gAway[gi]]++;
    }
    for (let t = 0; t < T; t++) {
      winCounts[t * N + s] = wins[t];
      tiebreak[t] = rnd(); // random tiebreak proxy for this sim
    }

    // Standings + playoffs per conference.
    let afcChamp = 0;
    let nfcChamp = 0;
    for (const conf of ["AFC", "NFC"] as Conference[]) {
      const standings: Standing[] = [];
      for (let t = 0; t < T; t++) {
        if (teams[t].conference !== conf) continue;
        standings.push({
          idx: t,
          wins: wins[t],
          tiebreak: tiebreak[t],
          conference: conf,
          division: teams[t].division,
        });
      }
      const cmp = (x: Standing, y: Standing) =>
        y.wins - x.wins || y.tiebreak - x.tiebreak;

      const byDiv: Record<string, Standing[]> = {};
      for (const st of standings) (byDiv[st.division] ??= []).push(st);
      const divWinners: Standing[] = [];
      for (const d of Object.keys(byDiv)) {
        byDiv[d].sort(cmp);
        divWinners.push(byDiv[d][0]);
      }
      divWinners.sort(cmp); // seeds 1-4
      const winnerSet = new Set(divWinners.map((w) => w.idx));

      const wildcards = standings
        .filter((st) => !winnerSet.has(st.idx))
        .sort(cmp)
        .slice(0, 3); // seeds 5-7
      const seeds = [...divWinners, ...wildcards];

      for (const w of divWinners) wonDivision[w.idx * N + s] = 1;
      for (const st of seeds) madePlayoffs[st.idx * N + s] = 1;

      const confChampIdx = simulatePlayoffs(seeds, pHomeMatrix, T, rnd);
      wonConference[confChampIdx * N + s] = 1;
      if (conf === "AFC") afcChamp = confChampIdx;
      else nfcChamp = confChampIdx;
    }

    // Super Bowl — neutral site.
    const pAfc = pNeutralMatrix[afcChamp * T + nfcChamp];
    const sbWinner = rnd() < pAfc ? afcChamp : nfcChamp;
    wonSuperbowl[sbWinner * N + s] = 1;
  }

  return {
    N,
    teamIds,
    index,
    winCounts,
    wonDivision,
    madePlayoffs,
    wonConference,
    wonSuperbowl,
  };
}

/** Reseeded 7-seed bracket. Returns the conference champion's team index. */
function simulatePlayoffs(
  seeds: Standing[],
  pHomeMatrix: Float64Array,
  T: number,
  rnd: () => number,
): number {
  const seedRank = new Map<number, number>();
  seeds.forEach((st, i) => seedRank.set(st.idx, i + 1));

  const play = (aIdx: number, bIdx: number): number => {
    const aHosts = (seedRank.get(aIdx) ?? 99) < (seedRank.get(bIdx) ?? 99);
    const home = aHosts ? aIdx : bIdx;
    const away = aHosts ? bIdx : aIdx;
    return rnd() < pHomeMatrix[home * T + away] ? home : away;
  };

  const idxOf = (rank: number) => seeds[rank - 1].idx;
  const w27 = play(idxOf(2), idxOf(7));
  const w36 = play(idxOf(3), idxOf(6));
  const w45 = play(idxOf(4), idxOf(5));

  const remaining = [idxOf(1), w27, w36, w45].sort(
    (a, b) => (seedRank.get(a) ?? 99) - (seedRank.get(b) ?? 99),
  );
  const d1 = play(remaining[0], remaining[3]);
  const d2 = play(remaining[1], remaining[2]);

  return play(d1, d2);
}
