// Core domain types for the NFL futures parlay finder.

export type Conference = "AFC" | "NFC";

export type DivisionName = "East" | "North" | "South" | "West";

export interface Team {
  /** Short code, e.g. "KC". */
  id: string;
  name: string;
  conference: Conference;
  division: DivisionName;
  /** Our model's Elo-scale power rating (1500 = league average). */
  rating: number;
}

/** The kinds of season-long futures markets we model. */
export type MarketType =
  | "division" // wins their division
  | "playoffs" // makes the playoffs (any of 7 seeds)
  | "conference" // wins their conference (reaches Super Bowl)
  | "superbowl" // wins the Super Bowl
  | "winsOver" // regular-season wins over a line
  | "winsUnder"; // regular-season wins under a line

/** A single sportsbook's price for a leg. */
export interface BookPrice {
  book: string; // e.g. "fanduel"
  american: number;
  decimal: number;
}

export interface Leg {
  id: string;
  market: MarketType;
  marketLabel: string;
  teamId: string;
  teamName: string;
  label: string;
  line?: number;
  /** The price you'll actually bet — FanDuel. */
  americanOdds: number;
  decimalOdds: number;
  /** FanDuel implied probability including vig. */
  impliedProb: number;
  /** All books' prices for line-shopping. */
  books: BookPrice[];
  /** Where the FanDuel price came from. */
  source: "live" | "custom" | "sample";
  /** True when the prices came from the live odds feed (not sample data). */
  live: boolean;
  /** Best (highest-payout) price across books, and which book. */
  bestBook: string;
  bestAmerican: number;
  bestDecimal: number;
  /** Vig-removed market consensus probability across books. */
  marketProb: number;
  /** Our model's estimated true probability (from the simulation). */
  modelProb: number;
  /** modelProb - marketProb: how far our model departs from the market. */
  divergence: number;
  /** Expected value per $1 on this leg at the FanDuel price. */
  legEv: number;
  /** Row index into the simulation tables. */
  simIndex: number;
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
  /** Combined decimal if each leg were bet at its best available book. */
  bestCombinedDecimal: number;
  bestCombinedAmerican: number;
  independentProb: number;
  /** True joint win prob from the simulation (handles correlation). */
  jointProb: number;
  /** jointProb pulled toward market consensus by the anchor weight. */
  anchoredProb: number;
  /** Book-implied combined prob (product of FanDuel implied). */
  impliedProb: number;
  /** Market-consensus combined prob (product of de-vigged marketProb). */
  marketProb: number;
  /** EV at the pure model probability. */
  ev: number;
  /** EV at the anchored probability — what filters and ranking use. */
  evAnchored: number;
  /** EV if bet at best available books instead of FanDuel. */
  evBest: number;
  roi: number;
  kellyFraction: number;
  /** jointProb / independentProb (1 = independent). */
  correlation: number;
  impossible: boolean;
  score: number;
}

export type SortObjective = "ev" | "prob" | "value" | "payout";

export interface RatingAdjustment {
  teamId: string;
  /** Elo points to add (negative for injuries/downgrades). */
  delta: number;
}

/** A regular-season game whose result is already known (in-season use). */
export interface DecidedGame {
  homeId: string;
  awayId: string;
  winnerId: string;
}

export interface SearchParams {
  minLegs: number;
  maxLegs: number;
  markets: MarketType[];
  includeTeams: string[];
  excludeTeams: string[];
  maxLegsPerTeam: number;
  minWinProb: number;
  minEv: number;
  minPayoutAmerican: number | null;
  maxPayoutAmerican: number | null;
  allowCorrelated: boolean;
  /** 0 = pure proprietary model, 1 = pure market; blended in log-odds. */
  anchorWeight: number;
  /** Drop legs where |modelProb - marketProb| exceeds this (null = off). */
  maxDivergence: number | null;
  /** Only keep parlays where FanDuel matches-or-beats every book on every leg
   *  (i.e. FanDuel's number is the soft one — you're getting the best price). */
  requireLineShopEdge: boolean;
  sortBy: SortObjective;
  limit: number;
  bankroll: number;
  kellyMultiplier: number;
}

/** Inputs that produce a distinct simulation (cached separately). */
export interface EngineOptions {
  adjustments?: RatingAdjustment[];
  decidedGames?: DecidedGame[];
  /** teamId -> QB id (or "replacement") starting instead of the default. */
  qbOverrides?: Record<string, string>;
}

/**
 * User-entered FanDuel prices for one team (American odds). These override
 * feed/sample prices, and `winLine` overrides the model-generated win-total
 * line so it matches FanDuel's actual posted line.
 */
export interface TeamCustomPrices {
  winLine?: number;
  winOver?: number;
  winUnder?: number;
  playoffsYes?: number;
  playoffsNo?: number;
  division?: number;
  conference?: number;
  superbowl?: number;
}

/** teamId -> custom FanDuel prices. */
export type CustomBoard = Record<string, TeamCustomPrices>;
