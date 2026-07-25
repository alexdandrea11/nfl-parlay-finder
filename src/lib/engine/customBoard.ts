// The FanDuel Price Board: user-entered futures prices, applied on top of
// the base odds map. Entered prices become the FanDuel price for that leg
// (feed/sample prices for other books are kept for line-shopping context),
// and a custom win-total LINE regenerates that team's win legs at FanDuel's
// actual posted number.

import { americanToDecimal } from "./odds";
import { sampleBooksFor } from "../data/oddsSource";
import type { LegMeta } from "./markets";
import type { BookPrice, CustomBoard, TeamCustomPrices } from "./types";

/** Validate/clean a client-supplied board. Unknown fields are dropped. */
export function parseCustomBoard(raw: unknown): CustomBoard {
  const out: CustomBoard = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [teamId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const p = v as Record<string, unknown>;
    const entry: TeamCustomPrices = {};
    const price = (x: unknown): number | undefined => {
      const n = Number(x);
      return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : undefined;
    };
    const line = Number(p.winLine);
    if (Number.isFinite(line) && line >= 0.5 && line <= 16.5) {
      entry.winLine = Math.round(line * 2) / 2;
    }
    entry.winOver = price(p.winOver);
    entry.winUnder = price(p.winUnder);
    entry.playoffsYes = price(p.playoffsYes);
    entry.division = price(p.division);
    entry.conference = price(p.conference);
    entry.superbowl = price(p.superbowl);
    if (Object.values(entry).some((x) => x != null)) out[teamId] = entry;
  }
  return out;
}

export function boardIsEmpty(board: CustomBoard): boolean {
  return Object.keys(board).length === 0;
}

/** Custom win-total lines from the board (teamId -> line). */
export function boardWinLines(board: CustomBoard): Record<string, number> {
  const lines: Record<string, number> = {};
  for (const [teamId, p] of Object.entries(board)) {
    if (p.winLine != null) lines[teamId] = p.winLine;
  }
  return lines;
}

function customPriceFor(meta: LegMeta, p: TeamCustomPrices): number | undefined {
  switch (meta.market) {
    case "division":
      return p.division;
    case "playoffs":
      return p.playoffsYes;
    case "conference":
      return p.conference;
    case "superbowl":
      return p.superbowl;
    case "winsOver":
      return p.winOver;
    case "winsUnder":
      return p.winUnder;
  }
}

/**
 * Apply the board to a set of legs. Returns the odds map to use and the set
 * of leg ids whose FanDuel price is user-entered. Legs whose id is missing
 * from the base map (a changed win line) get regenerated sample books before
 * the custom FanDuel price is layered on.
 */
export function applyBoard(
  metas: LegMeta[],
  baseOddsMap: Map<string, BookPrice[]>,
  board: CustomBoard,
): { oddsMap: Map<string, BookPrice[]>; customIds: Set<string> } {
  const oddsMap = new Map<string, BookPrice[]>();
  const customIds = new Set<string>();
  for (const m of metas) {
    let books = baseOddsMap.get(m.id) ?? sampleBooksFor(m);
    const custom = board[m.teamId] ? customPriceFor(m, board[m.teamId]) : undefined;
    if (custom != null) {
      books = [
        { book: "fanduel", american: custom, decimal: americanToDecimal(custom) },
        ...books.filter((b) => b.book !== "fanduel"),
      ];
      customIds.add(m.id);
    }
    oddsMap.set(m.id, books);
  }
  return { oddsMap, customIds };
}
