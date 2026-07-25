// Build the proprietary team model from nflverse public data.
//
//   node scripts/build-model.mjs
//
// Downloads (free, no key):
//   - stats_team_week_{season}.csv  → offensive EPA/play by unit, and (via
//     opponent_team) defensive EPA/play ALLOWED by unit
//   - games.csv                     → real schedules incl. the upcoming
//     season, plus head-to-head history
//
// Produces src/lib/data/generated/team-model.json consumed by the engine:
//   unit profiles (pass/rush × off/def), the real season schedule, and
//   division-rival head-to-head context.
//
// Method: per-season EPA-per-play rates, blended with recency weights, then
// shrunk toward league average (rosters/coaching turn over; preseason
// certainty is low). Deliberately NO player-vs-player terms: at NFL sample
// sizes those are noise. Unit-vs-unit is where matchup signal survives.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "lib", "data", "generated", "team-model.json");

const SEASONS = [2023, 2024, 2025];
const WEIGHTS = { 2025: 0.55, 2024: 0.3, 2023: 0.15 };
const SHRINK = 0.62; // preseason regression toward league mean
const TARGET_SEASON = 2026;
const H2H_SEASONS = [2021, 2022, 2023, 2024, 2025];

// nflverse team codes → ours.
const CODE_MAP = { LA: "LAR", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LAR" };
const mapCode = (c) => CODE_MAP[c] ?? c;

const DIVISIONS = {
  BUF: "AFC East", MIA: "AFC East", NYJ: "AFC East", NE: "AFC East",
  BAL: "AFC North", CIN: "AFC North", PIT: "AFC North", CLE: "AFC North",
  HOU: "AFC South", IND: "AFC South", JAX: "AFC South", TEN: "AFC South",
  KC: "AFC West", LAC: "AFC West", DEN: "AFC West", LV: "AFC West",
  PHI: "NFC East", DAL: "NFC East", WAS: "NFC East", NYG: "NFC East",
  DET: "NFC North", GB: "NFC North", MIN: "NFC North", CHI: "NFC North",
  TB: "NFC South", ATL: "NFC South", NO: "NFC South", CAR: "NFC South",
  SF: "NFC West", LAR: "NFC West", SEA: "NFC West", ARI: "NFC West",
};
const TEAM_IDS = Object.keys(DIVISIONS);

// --- tiny CSV parser (handles quoted fields) --------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows[0];
  return rows.slice(1).filter((r) => r.length === header.length).map((r) => {
    const o = {};
    header.forEach((h, i) => (o[h] = r[i]));
    return o;
  });
}

async function fetchCsv(url) {
  process.stdout.write(`  fetching ${url.split("/").pop()} … `);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const text = await res.text();
  const rows = parseCsv(text);
  console.log(`${rows.length} rows`);
  return rows;
}

// --- unit rates from weekly team stats --------------------------------------
async function seasonUnitRates(season) {
  const rows = await fetchCsv(
    `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`,
  );
  const reg = rows.filter((r) => r.season_type === "REG");
  const agg = {}; // team -> sums
  const blank = () => ({
    passEpa: 0, dropbacks: 0, rushEpa: 0, carries: 0, games: 0,
    passEpaAllowed: 0, dropbacksFaced: 0, rushEpaAllowed: 0, carriesFaced: 0,
  });
  for (const r of reg) {
    const team = mapCode(r.team);
    const opp = mapCode(r.opponent_team);
    if (!DIVISIONS[team] || !DIVISIONS[opp]) continue;
    const passEpa = Number(r.passing_epa) || 0;
    const dropbacks = (Number(r.attempts) || 0) + (Number(r.sacks_suffered) || 0);
    const rushEpa = Number(r.rushing_epa) || 0;
    const carries = Number(r.carries) || 0;
    const t = (agg[team] ??= blank());
    t.passEpa += passEpa; t.dropbacks += dropbacks;
    t.rushEpa += rushEpa; t.carries += carries;
    t.games += 1;
    const d = (agg[opp] ??= blank());
    d.passEpaAllowed += passEpa; d.dropbacksFaced += dropbacks;
    d.rushEpaAllowed += rushEpa; d.carriesFaced += carries;
  }
  const rates = {};
  for (const [team, t] of Object.entries(agg)) {
    rates[team] = {
      passOff: t.dropbacks ? t.passEpa / t.dropbacks : 0,
      rushOff: t.carries ? t.rushEpa / t.carries : 0,
      passDef: t.dropbacksFaced ? t.passEpaAllowed / t.dropbacksFaced : 0, // EPA allowed (lower = better D)
      rushDef: t.carriesFaced ? t.rushEpaAllowed / t.carriesFaced : 0,
      games: t.games,
    };
  }
  return rates;
}

function blendAndShrink(perSeason) {
  const keys = ["passOff", "rushOff", "passDef", "rushDef"];
  const blended = {};
  for (const id of TEAM_IDS) {
    const out = {};
    for (const k of keys) {
      let v = 0;
      let w = 0;
      for (const s of SEASONS) {
        const r = perSeason[s]?.[id];
        if (r) { v += WEIGHTS[s] * r[k]; w += WEIGHTS[s]; }
      }
      out[k] = w ? v / w : 0;
    }
    blended[id] = out;
  }
  // center on league mean, then shrink deviations
  const mean = {};
  for (const k of keys) mean[k] = TEAM_IDS.reduce((a, id) => a + blended[id][k], 0) / TEAM_IDS.length;
  for (const id of TEAM_IDS) {
    for (const k of keys) blended[id][k] = mean[k] + SHRINK * (blended[id][k] - mean[k]);
  }
  return { blended, leagueMean: mean };
}

// --- QB layer -----------------------------------------------------------------
// Per-QB passing EPA/dropback, blended across seasons and shrunk by volume
// (low-sample QBs regress hard toward the league QB mean). The engine
// attributes a fraction of a passing-offense swap to the QB (receivers, OL,
// and scheme carry the rest).
async function seasonQbRates(season) {
  const rows = await fetchCsv(
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${season}.csv`,
  );
  const out = {};
  for (const r of rows) {
    if (r.position !== "QB") continue;
    const dropbacks = (Number(r.attempts) || 0) + (Number(r.sacks_suffered) || 0);
    if (dropbacks < 20) continue;
    out[r.player_id] = {
      name: r.player_display_name,
      team: mapCode(r.recent_team),
      dropbacks,
      epa: Number(r.passing_epa) || 0,
    };
  }
  return out;
}

function buildQbTable(perSeasonQb) {
  const ids = new Set();
  for (const s of SEASONS) for (const id of Object.keys(perSeasonQb[s] ?? {})) ids.add(id);

  const raw = {};
  for (const id of ids) {
    let epaW = 0, dbW = 0, db2025 = 0;
    let name = "", team = "";
    for (const s of SEASONS) {
      const r = perSeasonQb[s]?.[id];
      if (!r) continue;
      epaW += WEIGHTS[s] * r.epa;
      dbW += WEIGHTS[s] * r.dropbacks;
      if (s === SEASONS[SEASONS.length - 1]) db2025 = r.dropbacks;
      name = r.name;
      team = r.team; // most recent season wins (SEASONS ascending)
    }
    const totalDb = SEASONS.reduce((a, s) => a + (perSeasonQb[s]?.[id]?.dropbacks ?? 0), 0);
    raw[id] = { id, name, team, ratePerDb: dbW > 0 ? epaW / dbW : 0, totalDb, dbRecent: db2025 };
  }

  const all = Object.values(raw);
  // League QB mean weighted by volume.
  const totDb = all.reduce((a, q) => a + q.totalDb, 0);
  const qbMean = all.reduce((a, q) => a + q.ratePerDb * q.totalDb, 0) / (totDb || 1);
  // Volume shrinkage.
  for (const q of all) q.rating = qbMean + (q.ratePerDb - qbMean) * (q.totalDb / (q.totalDb + 250));

  // Starters: most recent-season dropbacks per team.
  const starters = {};
  for (const q of all) {
    if (!DIVISIONS[q.team]) continue;
    if (!starters[q.team] || q.dbRecent > raw[starters[q.team]].dbRecent) starters[q.team] = q.id;
  }
  // Replacement level: backup tier = QBs ranked 33-56 by recent volume.
  const byRecent = [...all].sort((a, b) => b.dbRecent - a.dbRecent);
  const backups = byRecent.slice(32, 56);
  const replacement = backups.length
    ? backups.reduce((a, q) => a + q.rating, 0) / backups.length
    : qbMean - 0.08;

  const list = byRecent
    .slice(0, 110)
    .map((q) => ({ id: q.id, name: q.name, team: q.team, rating: q.rating, dropbacks: q.totalDb }))
    .sort((a, b) => b.rating - a.rating);
  return { list, starters, replacement, qbMean };
}

// --- schedule + head-to-head -------------------------------------------------
async function loadGames() {
  return fetchCsv("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv");
}

function extractSchedule(games, season) {
  return games
    .filter((g) => Number(g.season) === season && g.game_type === "REG")
    .map((g) => ({
      week: Number(g.week),
      home: mapCode(g.home_team),
      away: mapCode(g.away_team),
    }))
    .filter((g) => DIVISIONS[g.home] && DIVISIONS[g.away]);
}

function extractH2h(games) {
  const h2h = {};
  for (const g of games) {
    const season = Number(g.season);
    if (!H2H_SEASONS.includes(season)) continue;
    if (g.game_type !== "REG" || g.home_score === "" || g.away_score === "") continue;
    const home = mapCode(g.home_team);
    const away = mapCode(g.away_team);
    if (!DIVISIONS[home] || !DIVISIONS[away]) continue;
    if (DIVISIONS[home] !== DIVISIONS[away]) continue; // division rivals only
    const rec = {
      season,
      week: Number(g.week),
      home, away,
      homeScore: Number(g.home_score),
      awayScore: Number(g.away_score),
    };
    for (const [a, b] of [[home, away], [away, home]]) {
      ((h2h[a] ??= {})[b] ??= []).push(rec);
    }
  }
  return h2h;
}

// --- main ---------------------------------------------------------------------
console.log("Building team model from nflverse …");
const perSeason = {};
for (const s of SEASONS) perSeason[s] = await seasonUnitRates(s);
const { blended, leagueMean } = blendAndShrink(perSeason);

const perSeasonQb = {};
for (const s of SEASONS) perSeasonQb[s] = await seasonQbRates(s);
const qbs = buildQbTable(perSeasonQb);

const games = await loadGames();
const schedule = extractSchedule(games, TARGET_SEASON);
if (schedule.length !== 272) {
  console.warn(`  ! expected 272 games for ${TARGET_SEASON}, got ${schedule.length}`);
}
const h2h = extractH2h(games);

const model = {
  generatedAt: new Date().toISOString(),
  season: TARGET_SEASON,
  sourceSeasons: SEASONS,
  weights: WEIGHTS,
  shrink: SHRINK,
  leagueMean,
  units: blended,
  perSeason,
  qbs,
  schedule,
  h2h,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(model));
console.log(`\nWrote ${OUT}`);
console.log(`  schedule ${TARGET_SEASON}: ${schedule.length} games`);
const show = (id) => {
  const u = blended[id];
  console.log(
    `  ${id}: passOff ${u.passOff.toFixed(3)}  rushOff ${u.rushOff.toFixed(3)}  passDefAllowed ${u.passDef.toFixed(3)}  rushDefAllowed ${u.rushDef.toFixed(3)}`,
  );
};
["DET", "KC", "BUF", "CAR", "CLE"].forEach(show);
console.log(`  QBs: ${qbs.list.length} rated, replacement ${qbs.replacement.toFixed(3)}, mean ${qbs.qbMean.toFixed(3)}`);
console.log("  top 5 QBs:", qbs.list.slice(0, 5).map((q) => `${q.name} ${q.rating.toFixed(3)}`).join(", "));
console.log("  sample starters:", ["BUF", "KC", "CLE"].map((t) => `${t}:${qbs.list.find((q) => q.id === qbs.starters[t])?.name ?? "?"}`).join("  "));
