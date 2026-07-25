import { NextResponse } from "next/server";
import { MODEL_META } from "@/lib/engine/gameModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pull real played-game results for the current season from nflverse
// (games.csv gains scores as games finish) and return them as decidedGames.
// One click replaces manual result entry during the season.

const CODE_MAP: Record<string, string> = { LA: "LAR", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LAR" };
const mapCode = (c: string) => CODE_MAP[c] ?? c;

const TTL_MS = 60 * 60 * 1000; // 1h
let cache: { at: number; games: { homeId: string; awayId: string; winnerId: string; week: number }[] } | null = null;

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      const res = await fetch(
        "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`games.csv fetch failed (${res.status})`);
      const text = await res.text();
      const lines = text.split("\n");
      const header = lines[0].split(",");
      const col = (name: string) => header.indexOf(name);
      const iSeason = col("season");
      const iType = col("game_type");
      const iWeek = col("week");
      const iAway = col("away_team");
      const iAwayScore = col("away_score");
      const iHome = col("home_team");
      const iHomeScore = col("home_score");

      const games: { homeId: string; awayId: string; winnerId: string; week: number }[] = [];
      for (let li = 1; li < lines.length; li++) {
        // games.csv has no quoted commas in the columns we read; simple split
        // is safe because our columns are all before any free-text fields.
        const parts = lines[li].split(",");
        if (Number(parts[iSeason]) !== MODEL_META.season) continue;
        if (parts[iType] !== "REG") continue;
        const hs = parts[iHomeScore];
        const as = parts[iAwayScore];
        if (hs === "" || as === "" || hs == null || as == null) continue; // not played yet
        const home = mapCode(parts[iHome]);
        const away = mapCode(parts[iAway]);
        const homeScore = Number(hs);
        const awayScore = Number(as);
        if (homeScore === awayScore) continue; // ties: leave to the sim (rare)
        games.push({
          homeId: home,
          awayId: away,
          winnerId: homeScore > awayScore ? home : away,
          week: Number(parts[iWeek]),
        });
      }
      cache = { at: Date.now(), games };
    }
    return NextResponse.json({
      season: MODEL_META.season,
      played: cache.games.length,
      decidedGames: cache.games,
      fetchedAt: cache.at,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "season sync failed" },
      { status: 500 },
    );
  }
}
