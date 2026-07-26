// Weekly game lines (moneylines + spreads) from The Odds API — fully covered
// on the standard plan, unlike futures. 3 credits per refresh at a 3h TTL
// during usage ≈ well inside the monthly quota.

import { americanToDecimal } from "../engine/odds";
import { FULL_NAME_TO_ID } from "./teamNames";

export interface BookLine {
  book: string;
  mlHome: number | null;
  mlAway: number | null;
  spreadHome: number | null; // e.g. -4.5 (home favored by 4.5)
  spreadHomePrice: number | null;
  spreadAwayPrice: number | null;
  totalLine: number | null;
  overPrice: number | null;
  underPrice: number | null;
}

export interface GameOdds {
  eventId: string;
  commence: string;
  homeId: string;
  awayId: string;
  books: BookLine[];
}

const TTL_MS = 3 * 60 * 60 * 1000;
let cache: { games: GameOdds[]; fetchedAt: number; quotaRemaining: number | null } | null = null;
let inflight: Promise<void> | null = null;

interface ApiOutcome {
  name: string;
  price: number;
  point?: number;
}
interface ApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: { key: string; markets: { key: string; outcomes: ApiOutcome[] }[] }[];
}

async function fetchLines(): Promise<typeof cache> {
  const key = process.env.ODDS_API_KEY;
  if (!key || (process.env.ODDS_SOURCE ?? "sample") !== "live") return null;
  const url =
    `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/` +
    `?apiKey=${key}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.error(`Odds API game lines ${res.status}`);
    return null;
  }
  const quota = Number(res.headers.get("x-requests-remaining"));
  const events = (await res.json()) as ApiEvent[];
  const games: GameOdds[] = [];
  for (const ev of events) {
    const homeId = FULL_NAME_TO_ID[ev.home_team];
    const awayId = FULL_NAME_TO_ID[ev.away_team];
    if (!homeId || !awayId) continue;
    const books: BookLine[] = [];
    for (const bm of ev.bookmakers) {
      const h2h = bm.markets.find((m) => m.key === "h2h");
      const spreads = bm.markets.find((m) => m.key === "spreads");
      const mlHome = h2h?.outcomes.find((o) => o.name === ev.home_team)?.price ?? null;
      const mlAway = h2h?.outcomes.find((o) => o.name === ev.away_team)?.price ?? null;
      const sh = spreads?.outcomes.find((o) => o.name === ev.home_team);
      const sa = spreads?.outcomes.find((o) => o.name === ev.away_team);
      const totals = bm.markets.find((m) => m.key === "totals");
      const over = totals?.outcomes.find((o) => o.name === "Over");
      const under = totals?.outcomes.find((o) => o.name === "Under");
      books.push({
        book: bm.key,
        mlHome,
        mlAway,
        spreadHome: sh?.point ?? null,
        spreadHomePrice: sh?.price ?? null,
        spreadAwayPrice: sa?.price ?? null,
        totalLine: over?.point ?? null,
        overPrice: over?.price ?? null,
        underPrice: under?.price ?? null,
      });
    }
    if (books.length) games.push({ eventId: ev.id, commence: ev.commence_time, homeId, awayId, books });
  }
  return { games, fetchedAt: Date.now(), quotaRemaining: Number.isFinite(quota) ? quota : null };
}

export async function getGameLines() {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (!inflight) {
    inflight = fetchLines()
      .then((c) => {
        if (c) cache = c;
      })
      .catch((e) => console.error("game lines fetch failed:", e))
      .finally(() => {
        inflight = null;
      });
  }
  await inflight;
  return cache;
}

export function decimalOf(american: number): number {
  return americanToDecimal(american);
}
