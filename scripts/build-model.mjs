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
// Three refinements over raw EPA/play:
//   1. per-game rows kept so units can be OPPONENT-ADJUSTED (a +0.05 vs elite
//      defenses beats +0.08 vs cupcakes)
//   2. TURNOVER-LUCK regression: half of excess giveaway/takeaway value is
//      luck (fumble bounces, tipped INTs) — removed before rating
//   3. output shape unchanged, so blending/shrinking downstream is untouched.
const EPA_PER_TO = 4.2; // approximate EPA swing of one turnover
const TO_LUCK_SHARE = 0.5; // fraction of excess turnover value treated as luck

async function seasonUnitRates(season) {
  const rows = await fetchCsv(
    `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`,
  );
  const reg = rows.filter((r) => r.season_type === "REG");
  // Per-game offensive rows (defense = the opponent's offensive row).
  const games = [];
  for (const r of reg) {
    const team = mapCode(r.team);
    const opp = mapCode(r.opponent_team);
    if (!DIVISIONS[team] || !DIVISIONS[opp]) continue;
    const dropbacks = (Number(r.attempts) || 0) + (Number(r.sacks_suffered) || 0);
    const carries = Number(r.carries) || 0;
    games.push({
      team, opp,
      passRate: dropbacks ? (Number(r.passing_epa) || 0) / dropbacks : 0,
      rushRate: carries ? (Number(r.rushing_epa) || 0) / carries : 0,
      dropbacks, carries,
      giveP: (Number(r.passing_interceptions) || 0) + (Number(r.sack_fumbles_lost) || 0) + (Number(r.receiving_fumbles_lost) || 0),
      giveR: Number(r.rushing_fumbles_lost) || 0,
    });
  }

  // Iterative opponent adjustment per unit: a team's rating is its average
  // game rate relative to the (current estimate of) each opponent's unit.
  const teamsIn = [...new Set(games.map((g) => g.team))];
  const adjust = (rateKey, playKey) => {
    const lg =
      games.reduce((a, g) => a + g[rateKey] * g[playKey], 0) /
      Math.max(1, games.reduce((a, g) => a + g[playKey], 0));
    const off = {};
    const def = {};
    for (const t of teamsIn) { off[t] = lg; def[t] = lg; }
    for (let iter = 0; iter < 8; iter++) {
      const offNext = {};
      const defNext = {};
      for (const t of teamsIn) {
        const mine = games.filter((g) => g.team === t);
        offNext[t] = mine.length
          ? mine.reduce((a, g) => a + (g[rateKey] - (def[g.opp] - lg)), 0) / mine.length
          : lg;
        const faced = games.filter((g) => g.opp === t);
        defNext[t] = faced.length
          ? faced.reduce((a, g) => a + (g[rateKey] - (off[g.team] - lg)), 0) / faced.length
          : lg;
      }
      Object.assign(off, offNext);
      Object.assign(def, defNext);
    }
    return { off, def };
  };
  const pass = adjust("passRate", "dropbacks");
  const rush = adjust("rushRate", "carries");

  // Turnover-luck regression on top of the adjusted rates.
  const agg = {};
  for (const g of games) {
    const t = (agg[g.team] ??= { db: 0, ca: 0, giveP: 0, giveR: 0, takeP: 0, takeR: 0, dbF: 0, caF: 0, games: 0 });
    t.db += g.dropbacks; t.ca += g.carries; t.giveP += g.giveP; t.giveR += g.giveR; t.games++;
    const d = (agg[g.opp] ??= { db: 0, ca: 0, giveP: 0, giveR: 0, takeP: 0, takeR: 0, dbF: 0, caF: 0, games: 0 });
    d.takeP += g.giveP; d.takeR += g.giveR; d.dbF += g.dropbacks; d.caF += g.carries;
  }
  const tot = Object.values(agg);
  const lgGivePRate = tot.reduce((a, t) => a + t.giveP, 0) / Math.max(1, tot.reduce((a, t) => a + t.db, 0));
  const lgGiveRRate = tot.reduce((a, t) => a + t.giveR, 0) / Math.max(1, tot.reduce((a, t) => a + t.ca, 0));

  const rates = {};
  for (const team of teamsIn) {
    const t = agg[team];
    // Excess giveaways depressed offensive EPA; add back the luck share.
    const passOffAdj = t.db ? (TO_LUCK_SHARE * EPA_PER_TO * (t.giveP - lgGivePRate * t.db)) / t.db : 0;
    const rushOffAdj = t.ca ? (TO_LUCK_SHARE * EPA_PER_TO * (t.giveR - lgGiveRRate * t.ca)) / t.ca : 0;
    // Excess takeaways flattered the defense; give some back.
    const passDefAdj = t.dbF ? (TO_LUCK_SHARE * EPA_PER_TO * (t.takeP - lgGivePRate * t.dbF)) / t.dbF : 0;
    const rushDefAdj = t.caF ? (TO_LUCK_SHARE * EPA_PER_TO * (t.takeR - lgGiveRRate * t.caF)) / t.caF : 0;
    rates[team] = {
      passOff: pass.off[team] + passOffAdj,
      rushOff: rush.off[team] + rushOffAdj,
      passDef: pass.def[team] + passDefAdj,
      rushDef: rush.def[team] + rushDefAdj,
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

function buildQbTable(perSeasonQb, rosterMap) {
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

  // Reassign to current rosters; drop QBs no longer in the league.
  let all = Object.values(raw);
  if (rosterMap) {
    all = all.filter((q) => rosterMap[q.id]);
    for (const q of all) q.team = rosterMap[q.id];
  }
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

// --- Current-season rosters ----------------------------------------------------
// Historical stats tell us how good a player is; the CURRENT roster file
// tells us where he plays now (and whether he's still in the league).
// Anyone not on a TARGET_SEASON roster is dropped; movers are reassigned.
async function fetchRosterMap(season) {
  try {
    const rows = await fetchCsv(
      `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`,
    );
    const map = {};
    for (const r of rows) {
      const team = mapCode(r.team);
      if (r.gsis_id && DIVISIONS[team]) map[r.gsis_id] = team;
    }
    console.log(`  roster ${season}: ${Object.keys(map).length} players mapped`);
    return map;
  } catch (e) {
    console.warn(`  ! roster ${season} unavailable (${e.message}) — keeping stats-based teams`);
    return null;
  }
}

// --- Depth charts ---------------------------------------------------------------
// Latest published depth rank per player (1 = starter). Governs who projects
// as QB1 and damps usage for players buried on the chart.
async function fetchDepthMap(season) {
  try {
    const rows = await fetchCsv(
      `https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_${season}.csv`,
    );
    const latest = {};
    for (const r of rows) {
      if (!["QB", "RB", "WR", "TE"].includes(r.pos_abb)) continue;
      if (!r.gsis_id) continue;
      const rank = Number(r.pos_rank) || 9;
      const prev = latest[r.gsis_id];
      // Keep the newest snapshot (rows are dated); ties keep best rank.
      if (!prev || r.dt > prev.dt || (r.dt === prev.dt && rank < prev.rank)) {
        latest[r.gsis_id] = { dt: r.dt, rank };
      }
    }
    const map = {};
    for (const [id, v] of Object.entries(latest)) map[id] = v.rank;
    console.log(`  depth charts ${season}: ${Object.keys(map).length} players ranked`);
    return map;
  } catch (e) {
    console.warn(`  ! depth charts unavailable (${e.message})`);
    return null;
  }
}

// --- Player usage layer (for prop projections / SGP studio) -------------------
// Per-player per-game rates + team per-game volume, so runtime can compute
// usage SHARES and back player lines out of the game model's team totals.
const PLAYER_SEASONS = [2024, 2025];
const PLAYER_WEIGHTS = { 2024: 0.35, 2025: 0.65 };

async function seasonPlayerRates(season) {
  const rows = await fetchCsv(
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${season}.csv`,
  );
  const out = {};
  for (const r of rows) {
    if (!["QB", "RB", "WR", "TE"].includes(r.position)) continue;
    const team = mapCode(r.recent_team);
    if (!DIVISIONS[team]) continue;
    const g = Number(r.games) || 0;
    if (g < 3) continue;
    out[r.player_id] = {
      name: r.player_display_name,
      pos: r.position,
      team,
      g,
      passAtt: (Number(r.attempts) || 0) / g,
      passYds: (Number(r.passing_yards) || 0) / g,
      passTds: (Number(r.passing_tds) || 0) / g,
      carries: (Number(r.carries) || 0) / g,
      rushYds: (Number(r.rushing_yards) || 0) / g,
      rushTds: (Number(r.rushing_tds) || 0) / g,
      targets: (Number(r.targets) || 0) / g,
      rec: (Number(r.receptions) || 0) / g,
      recYds: (Number(r.receiving_yards) || 0) / g,
      recTds: (Number(r.receiving_tds) || 0) / g,
    };
  }
  return out;
}

function buildPlayerTable(perSeason, rosterMap, depthMap) {
  const ids = new Set();
  for (const s of PLAYER_SEASONS) for (const id of Object.keys(perSeason[s] ?? {})) ids.add(id);
  const KEYS = ["passAtt", "passYds", "passTds", "carries", "rushYds", "rushTds", "targets", "rec", "recYds", "recTds"];
  const byTeam = {};
  for (const id of ids) {
    const latest = perSeason[2025]?.[id] ?? perSeason[2024]?.[id];
    if (!latest) continue;
    // Current-roster truth: reassign movers, drop the departed/retired.
    let team = latest.team;
    if (rosterMap) {
      if (!rosterMap[id]) continue;
      team = rosterMap[id];
    }
    const blended = { id, name: latest.name, pos: latest.pos, team, g: 0, depth: depthMap?.[id] ?? null };
    let wSum = 0;
    for (const s of PLAYER_SEASONS) {
      const r = perSeason[s]?.[id];
      if (!r) continue;
      const w = PLAYER_WEIGHTS[s] * Math.min(1, r.g / 8);
      wSum += w;
      blended.g += r.g;
      for (const k of KEYS) blended[k] = (blended[k] ?? 0) + w * r[k];
    }
    if (!wSum) continue;
    for (const k of KEYS) blended[k] = Math.round(((blended[k] ?? 0) / wSum) * 100) / 100;
    (byTeam[team] ??= []).push(blended);
  }
  // Keep the ~12 most-used players per team (by touches+targets).
  for (const t of Object.keys(byTeam)) {
    byTeam[t].sort(
      (a, b) => b.passAtt + b.carries + b.targets - (a.passAtt + a.carries + a.targets),
    );
    byTeam[t] = byTeam[t].slice(0, 12);
  }
  // Team per-game volume baselines from 2025 player sums.
  const teamPerGame = {};
  for (const t of Object.keys(byTeam)) {
    const p25 = Object.values(perSeason[2025] ?? {}).filter((r) => r.team === t);
    teamPerGame[t] = {
      passAtt: Math.round(p25.reduce((a, r) => a + r.passAtt, 0) * 10) / 10,
      passYds: Math.round(p25.reduce((a, r) => a + r.passYds, 0) * 10) / 10,
      carries: Math.round(p25.reduce((a, r) => a + r.carries, 0) * 10) / 10,
      rushYds: Math.round(p25.reduce((a, r) => a + r.rushYds, 0) * 10) / 10,
    };
  }
  return { byTeam, teamPerGame };
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
      // Rest days going into the game (7 = normal week).
      hRest: Number(g.home_rest) || 7,
      aRest: Number(g.away_rest) || 7,
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

// --- experts: ESPN FPI (public JSON endpoint, no auth) -------------------------
// FPI is in points-vs-average (same scale as our power rating); projections[0]
// is ESPN's projected wins. Used for display/comparison only — never as a
// model input, so the model stays proprietary.
async function fetchFpi() {
  try {
    const res = await fetch(
      "https://site.web.api.espn.com/apis/fitt/v3/sports/football/nfl/powerindex?region=us&lang=en&limit=40",
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (!res.ok) throw new Error(`FPI ${res.status}`);
    const j = await res.json();
    const teams = {};
    for (const t of j.teams ?? []) {
      const id = mapCode(t.team.abbreviation);
      if (!DIVISIONS[id]) continue;
      const fpiCat = t.categories?.find((c) => c.name === "fpi");
      const projCat = t.categories?.find((c) => c.name === "projections");
      const fpi = Number(fpiCat?.values?.[0]);
      const projWins = Number(projCat?.values?.[0]);
      teams[id] = {
        fpi: Number.isFinite(fpi) ? fpi : null,
        projWins: Number.isFinite(projWins) ? projWins : null,
      };
    }
    if (Object.keys(teams).length < 30) throw new Error("FPI parse: too few teams");
    return { source: "ESPN FPI", season: j.requestedSeason?.year ?? j.currentSeason?.year, updatedAt: j.lastUpdated ?? null, teams };
  } catch (e) {
    console.warn(`  ! expert ratings unavailable (${e.message}) — continuing without`);
    return null;
  }
}

// --- main ---------------------------------------------------------------------
console.log("Building team model from nflverse …");
const perSeason = {};
for (const s of SEASONS) perSeason[s] = await seasonUnitRates(s);
const { blended, leagueMean } = blendAndShrink(perSeason);

const perSeasonQb = {};
for (const s of SEASONS) perSeasonQb[s] = await seasonQbRates(s);
const rosterMap = await fetchRosterMap(TARGET_SEASON);
const depthMap = await fetchDepthMap(TARGET_SEASON);
const qbs = buildQbTable(perSeasonQb, rosterMap);

const perSeasonPlayers = {};
for (const s of PLAYER_SEASONS) perSeasonPlayers[s] = await seasonPlayerRates(s);
const players = buildPlayerTable(perSeasonPlayers, rosterMap, depthMap);

const experts = await fetchFpi();

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
  players,
  experts,
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
