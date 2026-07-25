// Actual season results (regular season AND playoffs) from nfldata games.csv,
// cached 1h. Feeds the season-sync endpoint, in-season conditioning, and
// end-of-season bet grading.

import { MODEL_META } from "../engine/gameModel";

const CODE_MAP: Record<string, string> = { LA: "LAR", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LAR" };
const mapCode = (c: string) => CODE_MAP[c] ?? c;

export interface PlayedGame {
  homeId: string;
  awayId: string;
  winnerId: string;
  week: number;
  gameType: string; // REG, WC, DIV, CON, SB
}

export interface SeasonResults {
  season: number;
  reg: PlayedGame[];
  post: PlayedGame[];
  regComplete: boolean;
  fetchedAt: number;
}

const TTL_MS = 60 * 60 * 1000;
let cache: SeasonResults | null = null;
let inflight: Promise<void> | null = null;

async function fetchResults(): Promise<SeasonResults | null> {
  const res = await fetch(
    "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const lines = (await res.text()).split("\n");
  const header = lines[0].split(",");
  const col = (n: string) => header.indexOf(n);
  const iSeason = col("season");
  const iType = col("game_type");
  const iWeek = col("week");
  const iAway = col("away_team");
  const iAwayScore = col("away_score");
  const iHome = col("home_team");
  const iHomeScore = col("home_score");

  const reg: PlayedGame[] = [];
  const post: PlayedGame[] = [];
  let regScheduled = 0;
  for (let li = 1; li < lines.length; li++) {
    const p = lines[li].split(",");
    if (Number(p[iSeason]) !== MODEL_META.season) continue;
    const type = p[iType];
    if (type === "REG") regScheduled++;
    const hs = p[iHomeScore];
    const as = p[iAwayScore];
    if (hs === "" || as === "" || hs == null || as == null) continue;
    const homeScore = Number(hs);
    const awayScore = Number(as);
    if (homeScore === awayScore) continue; // ties: skip (rare; sim handles)
    const g: PlayedGame = {
      homeId: mapCode(p[iHome]),
      awayId: mapCode(p[iAway]),
      winnerId: homeScore > awayScore ? mapCode(p[iHome]) : mapCode(p[iAway]),
      week: Number(p[iWeek]),
      gameType: type,
    };
    if (type === "REG") reg.push(g);
    else post.push(g);
  }
  return {
    season: MODEL_META.season,
    reg,
    post,
    regComplete: regScheduled > 0 && reg.length === regScheduled,
    fetchedAt: Date.now(),
  };
}

export async function getSeasonResults(): Promise<SeasonResults | null> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (!inflight) {
    inflight = fetchResults()
      .then((r) => {
        if (r) cache = r;
      })
      .catch(() => {})
      .finally(() => {
        inflight = null;
      });
  }
  await inflight;
  return cache;
}
