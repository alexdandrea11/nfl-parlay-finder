// Unit-matchup game model.
//
// Each team is a 4-unit EPA/play profile (pass/rush offense, pass/rush
// defense-allowed) built from historical play-by-play (scripts/build-model.mjs).
// A game's expected margin comes from crossing each offense with the opposing
// defense — so a great pass attack vs a leaky secondary is worth more than the
// same attack vs an elite one. Win prob = Normal(margin / SD).
//
// This is unit-vs-unit by design: player-vs-player "ownage" terms are noise at
// NFL sample sizes and would make the model worse.

import model from "../data/generated/team-model.json";
import type { Team } from "./types";

export interface UnitProfile {
  passOff: number; // EPA per dropback
  rushOff: number; // EPA per carry
  passDef: number; // EPA per dropback ALLOWED (lower = better)
  rushDef: number; // EPA per carry ALLOWED
}

export interface ScheduledGame {
  week: number;
  home: string;
  away: string;
}

interface H2hGame {
  season: number;
  week: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

const PASS_PLAYS = 35; // dropbacks per team-game
const RUSH_PLAYS = 26; // carries per team-game
const HFA_PTS = 1.65; // home-field advantage in points
const MARGIN_SD = 13.2; // NFL margin distribution SD
const ELO_TO_PTS = 1 / 25; // slider adjustments are Elo-ish; 25 Elo ≈ 1 pt

export const MODEL_META = {
  generatedAt: model.generatedAt as string,
  season: model.season as number,
  sourceSeasons: model.sourceSeasons as number[],
};

const UNITS = model.units as Record<string, UnitProfile>;
const LEAGUE = model.leagueMean as UnitProfile;

export const SCHEDULE: ScheduledGame[] = model.schedule as ScheduledGame[];
export const H2H = model.h2h as Record<string, Record<string, H2hGame[]>>;

export interface ExpertRatings {
  source: string;
  season: number;
  updatedAt: string | null;
  teams: Record<string, { fpi: number | null; projWins: number | null }>;
}

export const EXPERTS: ExpertRatings | null =
  (model as { experts?: ExpertRatings }).experts ?? null;

export interface QbInfo {
  id: string;
  name: string;
  team: string;
  rating: number; // EPA per dropback, volume-shrunk
  dropbacks: number;
}

const QB_DATA = model.qbs as {
  list: QbInfo[];
  starters: Record<string, string>;
  replacement: number;
  qbMean: number;
};

export const QBS: QbInfo[] = QB_DATA.list;
export const QB_STARTERS: Record<string, string> = QB_DATA.starters;
export const QB_REPLACEMENT_RATING = QB_DATA.replacement;

// A QB swap moves this fraction of the passing-EPA gap — receivers, OL, and
// scheme carry the rest of a passing offense.
const QB_ATTRIBUTION = 0.75;

const qbById = new Map(QBS.map((q) => [q.id, q]));

function qbRating(id: string | undefined): number | null {
  if (!id) return null;
  if (id === "replacement") return QB_REPLACEMENT_RATING;
  return qbById.get(id)?.rating ?? null;
}

/**
 * Pass-offense EPA/dropback delta for a team starting `overrideId` instead of
 * its detected default starter. 0 when unknown or unchanged.
 */
export function qbPassOffDelta(teamId: string, overrideId: string | undefined): number {
  if (!overrideId) return 0;
  const starter = qbRating(QB_STARTERS[teamId]);
  const override = qbRating(overrideId);
  if (starter == null || override == null || overrideId === QB_STARTERS[teamId]) return 0;
  return QB_ATTRIBUTION * (override - starter);
}

export function unitsFor(teamId: string): UnitProfile {
  return UNITS[teamId] ?? LEAGUE;
}

export function leagueMean(): UnitProfile {
  return LEAGUE;
}

/**
 * Expected offensive EPA/game for offense A against defense B:
 * league baseline + offense's deviation + defense's deviation, per unit,
 * scaled by play volume.
 */
function offenseEpaVs(off: UnitProfile, def: UnitProfile): number {
  const passRate = LEAGUE.passOff + (off.passOff - LEAGUE.passOff) + (def.passDef - LEAGUE.passDef);
  const rushRate = LEAGUE.rushOff + (off.rushOff - LEAGUE.rushOff) + (def.rushDef - LEAGUE.rushDef);
  return PASS_PLAYS * passRate + RUSH_PLAYS * rushRate;
}

/** Fast standard-normal CDF (Zelen & Severo approximation). */
function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  let p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  if (z > 0) p = 1 - p;
  return p;
}

/**
 * Precompute a 32×32 win-probability matrix: P(home row beats away col) with
 * home-field advantage, given per-team point adjustments (injury sliders,
 * Elo-scale). Also returns the neutral-site version for the Super Bowl.
 */
export function buildWinProbMatrices(
  teams: Team[],
  adjustPts: Float64Array,
  passOffDelta?: Float64Array,
  unitsOverride?: Record<string, UnitProfile> | null,
): { home: Float64Array; neutral: Float64Array; marginHome: Float64Array } {
  const T = teams.length;
  const off = teams.map((t, i) => {
    const u = unitsOverride?.[t.id] ?? unitsFor(t.id);
    const d = passOffDelta?.[i] ?? 0;
    return d === 0 ? u : { ...u, passOff: u.passOff + d };
  });
  const epaVs = new Float64Array(T * T); // offense i vs defense j
  for (let i = 0; i < T; i++) {
    for (let j = 0; j < T; j++) {
      if (i === j) continue;
      epaVs[i * T + j] = offenseEpaVs(off[i], off[j]);
    }
  }
  const home = new Float64Array(T * T);
  const neutral = new Float64Array(T * T);
  const marginHome = new Float64Array(T * T);
  for (let h = 0; h < T; h++) {
    for (let a = 0; a < T; a++) {
      if (h === a) continue;
      const margin = epaVs[h * T + a] - epaVs[a * T + h] + adjustPts[h] - adjustPts[a];
      home[h * T + a] = normCdf((margin + HFA_PTS) / MARGIN_SD);
      neutral[h * T + a] = normCdf(margin / MARGIN_SD);
      marginHome[h * T + a] = margin + HFA_PTS;
    }
  }
  return { home, neutral, marginHome };
}

export const GAME_MARGIN_SD = MARGIN_SD;

/** P(actual home margin exceeds x) under the model's margin distribution. */
export function probMarginOver(expectedMargin: number, x: number): number {
  return normCdf((expectedMargin - x) / MARGIN_SD);
}

export function eloToPts(elo: number): number {
  return elo * ELO_TO_PTS;
}

/** Single-number power rating (expected margin vs an average team, neutral). */
export function powerPts(teamId: string, unitsOverride?: Record<string, UnitProfile> | null): number {
  const u = unitsOverride?.[teamId] ?? unitsFor(teamId);
  return offenseEpaVs(u, LEAGUE) - offenseEpaVs(LEAGUE, u);
}
