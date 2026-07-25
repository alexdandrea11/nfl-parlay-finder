// Logged-bet persistence, grading, and CLV — shared by /api/bets and the
// daily cron.

import { getSeasonResults } from "../data/seasonResults";
import { readDoc, writeDoc } from "../data/store";
import { gradeLeg, type LegOutcome } from "./grading";
import type { CustomBoard } from "./types";
import { getEngineView } from "./engineCache";

export interface LoggedBetLeg {
  id: string;
  label: string;
  market: string;
  teamId: string;
  americanOdds: number; // FD price at bet time
  impliedProb: number;
  modelProb: number;
  marketProb: number;
  outcome?: LegOutcome;
}

export interface LoggedBet {
  id: string;
  placedAt: number;
  legs: LoggedBetLeg[];
  stake: number;
  priceAmerican: number; // combined price actually bet
  jointProb: number; // model at bet time
  anchoredProb: number;
  anchorWeight: number;
  status: "open" | "won" | "lost";
  gradedAt?: number;
  /** Closing-line value per leg (current implied − implied at bet), pp. */
  clv?: Record<string, number>;
}

const DOC = "bets";

export async function loadBets(): Promise<LoggedBet[]> {
  return readDoc<LoggedBet[]>(DOC, []);
}

export async function saveBets(bets: LoggedBet[]): Promise<void> {
  await writeDoc(DOC, bets);
}

/** Grade open bets from actual results; persist if anything changed. */
export async function gradeBets(bets: LoggedBet[]): Promise<boolean> {
  const results = await getSeasonResults();
  if (!results) return false;
  let changed = false;
  for (const bet of bets) {
    if (bet.status !== "open") continue;
    let anyLost = false;
    let allWon = true;
    for (const leg of bet.legs) {
      const outcome = gradeLeg(leg.id, results);
      if (leg.outcome !== outcome) {
        leg.outcome = outcome;
        changed = true;
      }
      if (outcome === "lost") anyLost = true;
      if (outcome !== "won") allWon = false;
    }
    const next: LoggedBet["status"] = anyLost ? "lost" : allWon ? "won" : "open";
    if (next !== bet.status) {
      bet.status = next;
      bet.gradedAt = Date.now();
      changed = true;
    }
  }
  if (changed) await saveBets(bets);
  return changed;
}

/**
 * Refresh each open bet's per-leg CLV against current real prices (live feed
 * or the user's board). Sample prices are ignored — CLV vs a placeholder is
 * meaningless.
 */
export async function refreshClv(bets: LoggedBet[], board: CustomBoard): Promise<boolean> {
  const open = bets.filter((b) => b.status === "open");
  if (open.length === 0) return false;
  const engine = await getEngineView({}, board);
  const byId = new Map(engine.legs.map((l) => [l.id, l]));
  let changed = false;
  for (const bet of open) {
    const clv: Record<string, number> = {};
    for (const leg of bet.legs) {
      const cur = byId.get(leg.id);
      if (!cur || cur.source === "sample") continue;
      clv[leg.id] = cur.impliedProb - leg.impliedProb;
    }
    if (JSON.stringify(clv) !== JSON.stringify(bet.clv ?? {})) {
      bet.clv = clv;
      changed = true;
    }
  }
  if (changed) await saveBets(bets);
  return changed;
}
