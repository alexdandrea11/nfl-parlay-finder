import {
  buildWinProbMatrices,
  eloToPts,
  HFA_POINTS,
  probMarginOver,
  qbPassOffDelta,
  restAdjustment,
  SCHEDULE,
  type UnitProfile,
} from "./gameModel";
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
  /** Times each team landed each playoff seed: [teamIdx*7 + (seed-1)]. */
  seedCounts: Int32Array;
  /** Per-sim home-win bitsets for the next undecided week's games. */
  trackedGames: { homeId: string; awayId: string; week: number; homeBits: Uint32Array }[];
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

  const {
    home: pHomeMatrix,
    neutral: pNeutralMatrix,
    marginHome: marginMatrix,
  } = buildWinProbMatrices(teams, adjustPts, passOffDelta, unitsOverride);

  // Real schedule → per-game home-team win probability, precomputed once.
  const games = SCHEDULE.filter((g) => index[g.home] != null && index[g.away] != null);
  const G = games.length;
  const gHome = new Int32Array(G);
  const gAway = new Int32Array(G);
  const gProb = new Float64Array(G);
  const gMargin = new Float64Array(G);
  games.forEach((g, gi) => {
    const h = index[g.home];
    const a = index[g.away];
    gHome[gi] = h;
    gAway[gi] = a;
    // Schedule-spot adjustment: short weeks and byes move the margin.
    gMargin[gi] = marginMatrix[h * T + a] + restAdjustment(g.hRest, g.aRest);
    gProb[gi] = probMarginOver(gMargin[gi], 0);
  });

  // Rating uncertainty: preseason ratings are estimates, not facts. Each
  // simulated season draws a persistent rating error per team (~N(0, 2.5
  // pts)), which fattens the tails and keeps extreme probabilities honest.
  const RATING_SD = 2.5;
  const noise = new Float64Array(T);
  const gauss = () => {
    const u = Math.max(1e-12, rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };

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

  // Tiebreaker prep: which games are division/conference games, the game
  // indices for each team pair (head-to-head), and per-team conference game
  // counts (for conference-record percentage).
  const gIsDiv = new Uint8Array(G);
  const gIsConf = new Uint8Array(G);
  const pairGames = new Map<number, number[]>(); // lo*64+hi -> game indices
  const confGameCount = new Int16Array(T);
  for (let gi = 0; gi < G; gi++) {
    const h = gHome[gi];
    const a = gAway[gi];
    const sameConf = teams[h].conference === teams[a].conference;
    const sameDiv = sameConf && teams[h].division === teams[a].division;
    gIsConf[gi] = sameConf ? 1 : 0;
    gIsDiv[gi] = sameDiv ? 1 : 0;
    if (sameConf) {
      confGameCount[h]++;
      confGameCount[a]++;
    }
    const key = Math.min(h, a) * 64 + Math.max(h, a);
    const list = pairGames.get(key) ?? [];
    list.push(gi);
    pairGames.set(key, list);
  }

  // Track per-sim outcomes for the earliest week that still has undecided
  // games — powers the leverage board ("which game swings what").
  let trackWeek = Infinity;
  for (let gi = 0; gi < G; gi++) {
    if (!gDecided || gDecided[gi] < 0) trackWeek = Math.min(trackWeek, games[gi].week);
  }
  const trackedIdx: number[] = [];
  for (let gi = 0; gi < G; gi++) {
    if (games[gi].week === trackWeek && (!gDecided || gDecided[gi] < 0)) trackedIdx.push(gi);
  }
  const words = (N + 31) >>> 5;
  const trackedGames = trackedIdx.map((gi) => ({
    homeId: games[gi].home,
    awayId: games[gi].away,
    week: games[gi].week,
    homeBits: new Uint32Array(words),
  }));

  const winCounts = new Int16Array(T * N);
  const seedCounts = new Int32Array(T * 7);
  const wonDivision = new Uint8Array(T * N);
  const madePlayoffs = new Uint8Array(T * N);
  const wonConference = new Uint8Array(T * N);
  const wonSuperbowl = new Uint8Array(T * N);

  const rnd = mulberry32(seed);
  const wins = new Int16Array(T);
  const divWins = new Int16Array(T);
  const confWins = new Int16Array(T);
  const winnerOf = new Int32Array(G); // per-sim game winners for H2H lookups
  const tiebreak = new Float64Array(T);

  for (let s = 0; s < N; s++) {
    wins.fill(0);
    divWins.fill(0);
    confWins.fill(0);
    for (let t = 0; t < T; t++) noise[t] = gauss() * RATING_SD;
    // Regular season.
    for (let gi = 0; gi < G; gi++) {
      let w: number;
      if (gDecided && gDecided[gi] >= 0) w = gDecided[gi];
      else {
        const p = probMarginOver(gMargin[gi] + noise[gHome[gi]] - noise[gAway[gi]], 0);
        w = rnd() < p ? gHome[gi] : gAway[gi];
      }
      winnerOf[gi] = w;
      wins[w]++;
      if (gIsDiv[gi]) divWins[w]++;
      if (gIsConf[gi]) confWins[w]++;
    }
    for (let t = 0; t < T; t++) {
      winCounts[t * N + s] = wins[t];
      tiebreak[t] = rnd(); // last-resort tiebreak (coin flip)
    }
    for (let ti = 0; ti < trackedIdx.length; ti++) {
      if (winnerOf[trackedIdx[ti]] === gHome[trackedIdx[ti]]) {
        trackedGames[ti].homeBits[s >>> 5] |= 1 << (s & 31);
      }
    }

    // NFL-style tiebreak comparator (pairwise approximation of the official
    // procedure): head-to-head, then division record (same-division ties),
    // then conference record, then a coin flip.
    const tieCmp = (xIdx: number, yIdx: number): number => {
      const key = Math.min(xIdx, yIdx) * 64 + Math.max(xIdx, yIdx);
      const h2hGames = pairGames.get(key);
      if (h2hGames) {
        let xH2h = 0;
        for (const gi of h2hGames) {
          if (winnerOf[gi] === xIdx) xH2h++;
          else xH2h--;
        }
        if (xH2h !== 0) return -xH2h; // negative = x ranks first
      }
      if (
        teams[xIdx].conference === teams[yIdx].conference &&
        teams[xIdx].division === teams[yIdx].division &&
        divWins[xIdx] !== divWins[yIdx]
      ) {
        return divWins[yIdx] - divWins[xIdx];
      }
      const xConf = confWins[xIdx] / Math.max(1, confGameCount[xIdx]);
      const yConf = confWins[yIdx] / Math.max(1, confGameCount[yIdx]);
      if (xConf !== yConf) return yConf - xConf;
      return tiebreak[yIdx] - tiebreak[xIdx];
    };

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
        y.wins - x.wins || tieCmp(x.idx, y.idx);

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
      seeds.forEach((st, seedIdx) => {
        madePlayoffs[st.idx * N + s] = 1;
        seedCounts[st.idx * 7 + seedIdx]++;
      });

      const confChampIdx = simulatePlayoffs(seeds, marginMatrix, noise, T, rnd);
      wonConference[confChampIdx * N + s] = 1;
      if (conf === "AFC") afcChamp = confChampIdx;
      else nfcChamp = confChampIdx;
    }

    // Super Bowl — neutral site.
    const sbMargin =
      marginMatrix[afcChamp * T + nfcChamp] - HFA_POINTS + noise[afcChamp] - noise[nfcChamp];
    const sbWinner = rnd() < probMarginOver(sbMargin, 0) ? afcChamp : nfcChamp;
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
    seedCounts,
    trackedGames,
  };
}

/** Reseeded 7-seed bracket. Returns the conference champion's team index. */
function simulatePlayoffs(
  seeds: Standing[],
  marginMatrix: Float64Array,
  noise: Float64Array,
  T: number,
  rnd: () => number,
): number {
  const seedRank = new Map<number, number>();
  seeds.forEach((st, i) => seedRank.set(st.idx, i + 1));

  const play = (aIdx: number, bIdx: number): number => {
    const aHosts = (seedRank.get(aIdx) ?? 99) < (seedRank.get(bIdx) ?? 99);
    const home = aHosts ? aIdx : bIdx;
    const away = aHosts ? bIdx : aIdx;
    const p = probMarginOver(marginMatrix[home * T + away] + noise[home] - noise[away], 0);
    return rnd() < p ? home : away;
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
