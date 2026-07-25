import type { LegMeta } from "../engine/markets";
import { americanToDecimal, probToAmerican } from "../engine/odds";
import { mulberry32 } from "../engine/random";
import type { BookPrice, MarketType } from "../engine/types";
import { FULL_NAME_TO_ID } from "./teamNames";

export const ODDS_SOURCE = process.env.ODDS_SOURCE ?? "sample";

// Books we synthesize for markets the live feed doesn't cover.
export const SAMPLE_BOOKS = ["fanduel", "draftkings", "betmgm", "caesars", "espnbet"];

// Typical futures hold by market — bigger fields carry more vig.
const MARKET_MARGIN: Record<MarketType, number> = {
  superbowl: 0.26,
  conference: 0.16,
  division: 0.12,
  playoffs: 0.08,
  winsOver: 0.06,
  winsUnder: 0.06,
};

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** One book's sample price for a leg: model prob nudged by disagreement + vig. */
/** Regenerated sample books for a leg (used when a custom win line creates
 * leg ids the base odds map has never seen). */
export function sampleBooksFor(meta: LegMeta): BookPrice[] {
  return SAMPLE_BOOKS.map((b) => sampleBookPrice(meta, b));
}

function sampleBookPrice(meta: LegMeta, book: string): BookPrice {
  const rnd = mulberry32(hash(`${meta.id}:${book}`));
  const disagreement = (rnd() - 0.5) * 0.34; // +/-17% relative, per book
  const margin = MARKET_MARGIN[meta.market];
  const bookProb = Math.min(
    0.985,
    Math.max(0.004, meta.modelProb * (1 + disagreement) * (1 + margin)),
  );
  const american = probToAmerican(bookProb);
  return { book, american, decimal: americanToDecimal(american) };
}

export interface OddsResult {
  map: Map<string, BookPrice[]>;
  /** Leg ids whose prices came from the live feed. */
  liveIds: Set<string>;
  source: "live" | "sample";
  fetchedAt: number | null;
  /** Live markets covered, e.g. ["superbowl"]. */
  liveMarkets: string[];
  quotaRemaining: number | null;
}

// ---------------------------------------------------------------------------
// Live path: The Odds API (https://the-odds-api.com).
// NFL futures coverage is currently the Super Bowl Winner outright market.
// Everything the feed doesn't cover falls back to sample prices so every
// market keeps working; the UI flags which legs are live.
// ---------------------------------------------------------------------------

const LIVE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — futures move slowly; ~120 credits/mo

interface LiveCache {
  bySbTeam: Map<string, BookPrice[]>; // teamId -> prices
  fetchedAt: number;
  quotaRemaining: number | null;
}

let liveCache: LiveCache | null = null;
let liveFetch: Promise<LiveCache | null> | null = null;

interface ApiOutcome {
  name: string;
  price: number;
}
interface ApiBookmaker {
  key: string;
  markets: { key: string; outcomes: ApiOutcome[] }[];
}
interface ApiEvent {
  bookmakers: ApiBookmaker[];
}

async function fetchSuperBowlOdds(): Promise<LiveCache | null> {
  const key = process.env.ODDS_API_KEY;
  if (!key) return null;
  const url =
    `https://api.the-odds-api.com/v4/sports/americanfootball_nfl_super_bowl_winner/odds/` +
    `?apiKey=${key}&regions=us&oddsFormat=american`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.error(`Odds API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const quota = Number(res.headers.get("x-requests-remaining"));
  const events = (await res.json()) as ApiEvent[];
  const event = events?.[0];
  if (!event?.bookmakers?.length) return null;

  const bySbTeam = new Map<string, BookPrice[]>();
  for (const bm of event.bookmakers) {
    const market = bm.markets.find((m) => m.key === "outrights");
    if (!market) continue;
    for (const o of market.outcomes) {
      const teamId = FULL_NAME_TO_ID[o.name];
      if (!teamId) continue;
      const prices = bySbTeam.get(teamId) ?? [];
      prices.push({ book: bm.key, american: o.price, decimal: americanToDecimal(o.price) });
      bySbTeam.set(teamId, prices);
    }
  }
  return {
    bySbTeam,
    fetchedAt: Date.now(),
    quotaRemaining: Number.isFinite(quota) ? quota : null,
  };
}

async function getLiveCache(): Promise<LiveCache | null> {
  if (liveCache && Date.now() - liveCache.fetchedAt < LIVE_TTL_MS) return liveCache;
  // Deduplicate concurrent fetches.
  if (!liveFetch) {
    liveFetch = fetchSuperBowlOdds()
      .catch((e) => {
        console.error("Odds API fetch failed:", e);
        return null;
      })
      .then((c) => {
        if (c) liveCache = c;
        liveFetch = null;
        return c;
      });
  }
  await liveFetch;
  return liveCache; // may still be a stale-but-usable cache, or null
}

/**
 * Build the odds map (legId -> prices at each book). Live prices where the
 * feed covers the market (FanDuel required — a leg is only "live" if FanDuel
 * itself priced it); seeded sample prices everywhere else so the whole tool
 * keeps working.
 */
export async function getOddsMap(metas: LegMeta[]): Promise<OddsResult> {
  const map = new Map<string, BookPrice[]>();
  const liveIds = new Set<string>();
  let live: LiveCache | null = null;

  if (ODDS_SOURCE === "live") {
    live = await getLiveCache();
  }

  for (const m of metas) {
    if (m.market === "superbowl" && live) {
      const prices = live.bySbTeam.get(m.teamId);
      if (prices?.some((p) => p.book === "fanduel")) {
        map.set(m.id, prices);
        liveIds.add(m.id);
        continue;
      }
    }
    map.set(m.id, SAMPLE_BOOKS.map((b) => sampleBookPrice(m, b)));
  }

  return {
    map,
    liveIds,
    source: live ? "live" : "sample",
    fetchedAt: live?.fetchedAt ?? null,
    liveMarkets: live ? ["superbowl"] : [],
    quotaRemaining: live?.quotaRemaining ?? null,
  };
}
