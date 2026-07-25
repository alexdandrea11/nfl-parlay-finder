// Runtime freshness overlays. The baked team-model.json holds stable priors
// (2023-25 units, schedule, H2H, QBs). This module fetches what changes
// during the season — today's expert ratings and this season's actual
// performance — with TTL caches and graceful fallbacks to the baked data.
// The engine rebuilds every BASE_TTL, picking these up automatically.

import { EXPERTS, MODEL_META, type ExpertRatings, type UnitProfile } from "../engine/gameModel";
import { TEAMS_BY_ID } from "./teams";

const FPI_TTL_MS = 12 * 60 * 60 * 1000;
const STATS_TTL_MS = 12 * 60 * 60 * 1000;

// --- tiny CSV parser (quoted fields safe) -----------------------------------
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows[0] ?? [];
  return rows
    .slice(1)
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const CODE_MAP: Record<string, string> = { LA: "LAR", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LAR" };
const mapCode = (c: string) => CODE_MAP[c] ?? c;

// --- Experts: ESPN FPI, refreshed at runtime --------------------------------

interface FpiCache {
  data: ExpertRatings;
  fetchedAt: number;
}
let fpiCache: FpiCache | null = null;
let fpiFetch: Promise<void> | null = null;

async function fetchFpi(): Promise<ExpertRatings | null> {
  const res = await fetch(
    "https://site.web.api.espn.com/apis/fitt/v3/sports/football/nfl/powerindex?region=us&lang=en&limit=40",
    { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" },
  );
  if (!res.ok) return null;
  const j = (await res.json()) as {
    requestedSeason?: { year?: number };
    currentSeason?: { year?: number };
    lastUpdated?: string;
    teams?: {
      team: { abbreviation: string };
      categories?: { name: string; values?: number[] }[];
    }[];
  };
  const teams: ExpertRatings["teams"] = {};
  for (const t of j.teams ?? []) {
    const id = mapCode(t.team.abbreviation);
    const fpi = Number(t.categories?.find((c) => c.name === "fpi")?.values?.[0]);
    const projWins = Number(t.categories?.find((c) => c.name === "projections")?.values?.[0]);
    teams[id] = {
      fpi: Number.isFinite(fpi) ? fpi : null,
      projWins: Number.isFinite(projWins) ? projWins : null,
    };
  }
  if (Object.keys(teams).length < 30) return null;
  return {
    source: "ESPN FPI",
    season: j.requestedSeason?.year ?? j.currentSeason?.year ?? MODEL_META.season,
    updatedAt: j.lastUpdated ?? new Date().toISOString(),
    teams,
  };
}

/** Freshest available expert ratings: runtime fetch, falling back to baked. */
export async function getExperts(): Promise<{ data: ExpertRatings | null; live: boolean }> {
  if (fpiCache && Date.now() - fpiCache.fetchedAt < FPI_TTL_MS) {
    return { data: fpiCache.data, live: true };
  }
  if (!fpiFetch) {
    fpiFetch = fetchFpi()
      .then((d) => {
        if (d) fpiCache = { data: d, fetchedAt: Date.now() };
      })
      .catch(() => {})
      .finally(() => {
        fpiFetch = null;
      });
  }
  await fpiFetch;
  if (fpiCache) return { data: fpiCache.data, live: true };
  return { data: EXPERTS, live: false }; // baked snapshot
}

// --- In-season unit stats: this season's actual EPA -------------------------

export interface SeasonOverlay {
  /** Raw current-season EPA/play rates per team. */
  rates: Record<string, UnitProfile>;
  gamesPlayed: Record<string, number>;
  maxWeek: number;
  fetchedAt: number;
}

let statsCache: SeasonOverlay | null = null;
let statsMiss = 0; // timestamp of last 404 so we don't hammer preseason
let statsFetch: Promise<void> | null = null;

async function fetchSeasonStats(): Promise<SeasonOverlay | null> {
  const url = `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${MODEL_META.season}.csv`;
  const res = await fetch(url, { redirect: "follow", cache: "no-store" });
  if (!res.ok) return null; // file appears once the season starts
  const rows = parseCsv(await res.text()).filter((r) => r.season_type === "REG");
  if (rows.length === 0) return null;

  const blank = () => ({
    passEpa: 0,
    dropbacks: 0,
    rushEpa: 0,
    carries: 0,
    games: 0,
    passEpaAllowed: 0,
    dropbacksFaced: 0,
    rushEpaAllowed: 0,
    carriesFaced: 0,
  });
  const agg: Record<string, ReturnType<typeof blank>> = {};
  let maxWeek = 0;
  for (const r of rows) {
    const team = mapCode(r.team);
    const opp = mapCode(r.opponent_team);
    if (!TEAMS_BY_ID[team] || !TEAMS_BY_ID[opp]) continue;
    const passEpa = Number(r.passing_epa) || 0;
    const dropbacks = (Number(r.attempts) || 0) + (Number(r.sacks_suffered) || 0);
    const rushEpa = Number(r.rushing_epa) || 0;
    const carries = Number(r.carries) || 0;
    maxWeek = Math.max(maxWeek, Number(r.week) || 0);
    const t = (agg[team] ??= blank());
    t.passEpa += passEpa;
    t.dropbacks += dropbacks;
    t.rushEpa += rushEpa;
    t.carries += carries;
    t.games += 1;
    const d = (agg[opp] ??= blank());
    d.passEpaAllowed += passEpa;
    d.dropbacksFaced += dropbacks;
    d.rushEpaAllowed += rushEpa;
    d.carriesFaced += carries;
  }
  const rates: Record<string, UnitProfile> = {};
  const gamesPlayed: Record<string, number> = {};
  for (const [team, t] of Object.entries(agg)) {
    rates[team] = {
      passOff: t.dropbacks ? t.passEpa / t.dropbacks : 0,
      rushOff: t.carries ? t.rushEpa / t.carries : 0,
      passDef: t.dropbacksFaced ? t.passEpaAllowed / t.dropbacksFaced : 0,
      rushDef: t.carriesFaced ? t.rushEpaAllowed / t.carriesFaced : 0,
    };
    gamesPlayed[team] = t.games;
  }
  return { rates, gamesPlayed, maxWeek, fetchedAt: Date.now() };
}

/**
 * Current-season overlay, or null before the season's data exists.
 * Cached 12h; a miss (preseason 404) is also cached 12h.
 */
export async function getSeasonOverlay(): Promise<SeasonOverlay | null> {
  const fresh =
    (statsCache && Date.now() - statsCache.fetchedAt < STATS_TTL_MS) ||
    (statsMiss && Date.now() - statsMiss < STATS_TTL_MS);
  if (!fresh && !statsFetch) {
    statsFetch = fetchSeasonStats()
      .then((d) => {
        if (d) statsCache = d;
        else statsMiss = Date.now();
      })
      .catch(() => {
        statsMiss = Date.now();
      })
      .finally(() => {
        statsFetch = null;
      });
  }
  if (statsFetch) await statsFetch;
  return statsCache;
}

/**
 * Blend baked priors with current-season rates. Weight grows with games
 * played: w = gp / (gp + K). K=10 → the current season is half the model by
 * week 10, dominant by season's end. Returns null when nothing to blend.
 */
export function blendUnits(
  priorFor: (teamId: string) => UnitProfile,
  teamIds: string[],
  overlay: SeasonOverlay | null,
  K = 10,
): Record<string, UnitProfile> | null {
  if (!overlay) return null;
  const out: Record<string, UnitProfile> = {};
  for (const id of teamIds) {
    const prior = priorFor(id);
    const cur = overlay.rates[id];
    const gp = overlay.gamesPlayed[id] ?? 0;
    if (!cur || gp === 0) {
      out[id] = prior;
      continue;
    }
    const w = gp / (gp + K);
    out[id] = {
      passOff: prior.passOff + w * (cur.passOff - prior.passOff),
      rushOff: prior.rushOff + w * (cur.rushOff - prior.rushOff),
      passDef: prior.passDef + w * (cur.passDef - prior.passDef),
      rushDef: prior.rushDef + w * (cur.rushDef - prior.rushDef),
    };
  }
  return out;
}
