// Shared client-side types mirroring the API responses.

export type MarketType =
  | "division"
  | "playoffs"
  | "conference"
  | "superbowl"
  | "winsOver"
  | "winsUnder";

export interface TeamMeta {
  id: string;
  name: string;
  conference: string;
  division: string;
  rating: number;
}

export interface BookPrice {
  book: string;
  american: number;
  decimal: number;
}

export interface OddsMeta {
  source: "live" | "sample";
  fetchedAt: number | null;
  liveMarkets: string[];
  liveLegCount: number;
  quotaRemaining: number | null;
}

export interface LegRow {
  id: string;
  live: boolean;
  source: "live" | "custom" | "sample";
  market: MarketType;
  marketLabel: string;
  teamId: string;
  label: string;
  americanOdds: number;
  bestBook: string;
  bestAmerican: number;
  modelProb: number;
  marketProb: number;
  impliedProb: number;
  legEv: number;
  divergence: number;
  books: BookPrice[];
}

export interface ParlayLeg {
  id: string;
  label: string;
  market: MarketType;
  teamId: string;
  americanOdds: number;
  decimalOdds: number;
  bestBook: string;
  bestAmerican: number;
  modelProb: number;
  marketProb: number;
  impliedProb: number;
}

export interface Parlay {
  legs: ParlayLeg[];
  combinedDecimal: number;
  combinedAmerican: number;
  bestCombinedDecimal: number;
  bestCombinedAmerican: number;
  independentProb: number;
  jointProb: number;
  anchoredProb: number;
  impliedProb: number;
  marketProb: number;
  ev: number;
  evAnchored: number;
  evBest: number;
  kellyFraction: number;
  correlation: number;
  impossible: boolean;
  score: number;
}

export interface SearchResponse {
  parlays: Parlay[];
  evaluated: number;
  poolSize: number;
  truncatedPool: boolean;
  hitEvalCap: boolean;
  sims: number;
  searchMs: number;
  conditioned: boolean;
  oddsMeta?: OddsMeta;
}

export interface Adjustment {
  teamId: string;
  delta: number;
}

export interface QbInfo {
  id: string;
  name: string;
  team: string;
  rating: number;
  dropbacks: number;
}

export interface ScheduledGame {
  week: number;
  home: string;
  away: string;
}

/** teamId -> overriding QB id (or "replacement"). */
export type QbOverrides = Record<string, string>;

/** FanDuel Price Board: user-entered prices for one team (American odds). */
export interface TeamCustomPrices {
  winLine?: number;
  winOver?: number;
  winUnder?: number;
  playoffsYes?: number;
  division?: number;
  conference?: number;
  superbowl?: number;
}

export type CustomBoard = Record<string, TeamCustomPrices>;

export interface TicketResult {
  legIds: string[];
  legLabels: string[];
  stake: number;
  combinedDecimal: number;
  combinedAmerican: number;
  jointProb: number;
  ev: number;
  toWin: number;
  valid: boolean;
}

export interface PortfolioResponse {
  tickets: TicketResult[];
  totalStake: number;
  expectedPnl: number;
  expectedRoi: number;
  probProfit: number;
  probTotalLoss: number;
  best: number;
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  exposure: { teamId: string; stake: number; pct: number }[];
  sims: number;
}

export interface DiagnosticsResponse {
  sims: number;
  invariants: { name: string; expected: number; actual: number; ok: boolean }[];
  invariantsPass: boolean;
  agreement: {
    rmse: number;
    bias: number;
    bins: { center: number; meanMarket: number; meanModel: number; count: number }[];
    byMarket: { market: MarketType; rmse: number; count: number }[];
  };
  calibration: {
    n: number;
    brier: number;
    logLoss: number;
    hitRate: number;
    meanPredicted: number;
    bins: { lo: number; hi: number; predicted: number; empirical: number; count: number }[];
  };
  calibrationIsSynthetic: boolean;
}

/** A saved search whose thresholds act as an alert definition. */
export interface SavedSearch {
  id: string;
  name: string;
  createdAt: number;
  body: Record<string, unknown>;
  /** Alert if a result appears with EV >= this. */
  alertMinEv: number;
  lastRun?: number;
  lastTopEv?: number | null;
  lastCount?: number;
}

export interface SavedTicket {
  legIds: string[];
  stake: number;
  note?: string;
}

export const MARKETS: { key: MarketType; label: string }[] = [
  { key: "superbowl", label: "Super Bowl" },
  { key: "conference", label: "Conference" },
  { key: "division", label: "Division" },
  { key: "playoffs", label: "Make Playoffs" },
  { key: "winsOver", label: "Wins Over" },
  { key: "winsUnder", label: "Wins Under" },
];

export function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

/** A saved fantasy roster (multiple leagues supported). */
export interface FantasyRoster {
  id: string;
  name: string;
  playerIds: string[];
}
