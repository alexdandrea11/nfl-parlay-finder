import { TEAMS } from "../data/teams";
import { blendUnits, getSeasonOverlay } from "../data/freshness";
import { getOddsMap, type OddsResult } from "../data/oddsSource";
import { applyBoard, boardIsEmpty, boardWinLines } from "./customBoard";
import { unitsFor, type UnitProfile } from "./gameModel";
import {
  assembleLegs,
  computeConsensus,
  computeWinLines,
  enumerateLegs,
} from "./markets";
import { runSimulation, type SimResult } from "./simulate";
import type { BookPrice, CustomBoard, EngineOptions, Leg, Team } from "./types";

const SIMS = Number(process.env.SIM_COUNT ?? 20000);
// Rebuild the base engine when the odds cache TTL elapses (matches oddsSource).
const BASE_TTL_MS = 6 * 60 * 60 * 1000;

export interface OddsMeta {
  source: "live" | "sample";
  fetchedAt: number | null;
  liveMarkets: string[];
  liveLegCount: number;
  quotaRemaining: number | null;
}

export interface Freshness {
  /** Week the in-season stats run through, or null preseason. */
  seasonStatsWeek: number | null;
  seasonStatsFetchedAt: number | null;
}

export interface Engine {
  sim: SimResult;
  legs: Leg[];
  teams: Team[];
  sims: number;
  options: EngineOptions;
  oddsMeta: OddsMeta;
  /** Effective unit profiles (priors blended with this season), if blending is active. */
  units: Record<string, UnitProfile> | null;
  freshness: Freshness;
}

interface BaseEngine extends Engine {
  oddsMap: Map<string, BookPrice[]>;
  consensus: Map<string, number>;
  liveIds: Set<string>;
  lines: Record<string, number>;
  builtAt: number;
}

let base: BaseEngine | null = null;
let baseBuild: Promise<BaseEngine> | null = null;
const variants = new Map<string, Engine>();
const MAX_VARIANTS = 24;

async function buildBase(): Promise<BaseEngine> {
  // In-season overlay: blend this season's actual EPA into the priors with a
  // games-played weight. Null preseason (data doesn't exist yet).
  const overlay = await getSeasonOverlay();
  const units = blendUnits(unitsFor, TEAMS.map((t) => t.id), overlay);
  const freshness: Freshness = {
    seasonStatsWeek: overlay?.maxWeek ?? null,
    seasonStatsFetchedAt: overlay?.fetchedAt ?? null,
  };
  const sim = runSimulation(TEAMS, SIMS, 20250901, {}, units);
  const lines = computeWinLines(sim, TEAMS);
  const metas = enumerateLegs(sim, TEAMS, lines);
  const odds: OddsResult = await getOddsMap(metas);
  const consensus = computeConsensus(metas, odds.map);
  const legs = assembleLegs(metas, odds.map, consensus, odds.liveIds);
  return {
    sim,
    legs,
    teams: TEAMS,
    sims: SIMS,
    options: {},
    units,
    freshness,
    oddsMap: odds.map,
    consensus,
    liveIds: odds.liveIds,
    lines,
    builtAt: Date.now(),
    oddsMeta: {
      source: odds.source,
      fetchedAt: odds.fetchedAt,
      liveMarkets: odds.liveMarkets,
      liveLegCount: odds.liveIds.size,
      quotaRemaining: odds.quotaRemaining,
    },
  };
}

async function getBase(): Promise<BaseEngine> {
  const stale = !base || Date.now() - base.builtAt > BASE_TTL_MS;
  if (!stale) return base!;
  if (!baseBuild) {
    baseBuild = buildBase()
      .then((b) => {
        base = b;
        variants.clear(); // consensus may have moved; variant legs embed it
        return b;
      })
      .finally(() => {
        baseBuild = null;
      });
  }
  // If we have a stale base, serve it while the refresh happens in-flight.
  if (base) return base;
  return baseBuild;
}

function keyOf(options: EngineOptions): string {
  const adj = [...(options.adjustments ?? [])]
    .filter((a) => a.delta !== 0)
    .sort((a, b) => a.teamId.localeCompare(b.teamId))
    .map((a) => `${a.teamId}${a.delta > 0 ? "+" : ""}${a.delta}`)
    .join(",");
  const dec = [...(options.decidedGames ?? [])]
    .map((g) => `${g.homeId}@${g.awayId}>${g.winnerId}`)
    .sort()
    .join(",");
  const qb = Object.entries(options.qbOverrides ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, q]) => `${t}=${q}`)
    .join(",");
  return `a[${adj}]d[${dec}]q[${qb}]`;
}

export async function getEngine(options: EngineOptions = {}): Promise<Engine> {
  const b = await getBase();
  const key = keyOf(options);
  if (key === "a[]d[]q[]") return b;
  const hit = variants.get(key);
  if (hit) return hit;

  const sim = runSimulation(TEAMS, SIMS, 20250901, options, b.units);
  // Reuse the BASE win lines, odds, and consensus so only the model moves.
  const metas = enumerateLegs(sim, TEAMS, b.lines);
  const legs = assembleLegs(metas, b.oddsMap, b.consensus, b.liveIds);
  const engine: Engine = {
    sim,
    legs,
    teams: TEAMS,
    sims: SIMS,
    options,
    units: b.units,
    freshness: b.freshness,
    oddsMeta: b.oddsMeta,
  };

  if (variants.size >= MAX_VARIANTS) {
    const oldest = variants.keys().next().value;
    if (oldest) variants.delete(oldest);
  }
  variants.set(key, engine);
  return engine;
}

export interface EngineView extends Engine {
  customLegCount: number;
}

/**
 * Engine with the user's FanDuel Price Board applied: entered prices become
 * FanDuel's price, custom win lines regenerate win-total legs at FanDuel's
 * posted number, and consensus is recomputed. The simulation itself is
 * untouched (and stays cached) — the board only moves prices, never the model.
 */
export async function getEngineView(
  options: EngineOptions = {},
  board: CustomBoard = {},
): Promise<EngineView> {
  const engine = await getEngine(options);
  if (boardIsEmpty(board)) return { ...engine, customLegCount: 0 };
  const b = await getBase();
  const lines = { ...b.lines, ...boardWinLines(board) };
  const metas = enumerateLegs(engine.sim, TEAMS, lines);
  const { oddsMap, customIds } = applyBoard(metas, b.oddsMap, board);
  const consensus = computeConsensus(metas, oddsMap);
  const legs = assembleLegs(metas, oddsMap, consensus, b.liveIds, customIds);
  return { ...engine, legs, customLegCount: customIds.size };
}
