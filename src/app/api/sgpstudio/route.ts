import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine/engineCache";
import { probToAmerican, americanToImplied, americanToDecimal } from "@/lib/engine/odds";
import { projectGame, propSd } from "@/lib/engine/props";
import { mulberry32 } from "@/lib/engine/random";
import type { DecidedGame, EngineOptions, RatingAdjustment } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SGP Studio: model-consistent player projections for one game, live FanDuel
// prop lines fetched ON DEMAND (a few API credits per click), per-prop edges,
// and auto-suggested SGP combos priced with a correlated Monte Carlo.

interface PropLine {
  player: string;
  market: "pass" | "rush" | "rec";
  line: number;
  overPrice: number;
  underPrice: number | null;
}

const PROP_MARKETS = "player_pass_yds,player_rush_yds,player_reception_yds";
const propCache = new Map<string, { lines: PropLine[]; at: number }>();

async function fetchProps(eventId: string): Promise<PropLine[] | null> {
  const cached = propCache.get(eventId);
  if (cached && Date.now() - cached.at < 3 * 60 * 60 * 1000) return cached.lines;
  const key = process.env.ODDS_API_KEY;
  if (!key || (process.env.ODDS_SOURCE ?? "sample") !== "live") return null;
  const url =
    `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/${eventId}/odds` +
    `?apiKey=${key}&regions=us&bookmakers=fanduel&markets=${PROP_MARKETS}&oddsFormat=american`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    bookmakers?: { key: string; markets: { key: string; outcomes: { name: string; description?: string; price: number; point?: number }[] }[] }[];
  };
  const fd = j.bookmakers?.find((b) => b.key === "fanduel");
  const lines: PropLine[] = [];
  for (const m of fd?.markets ?? []) {
    const market = m.key.includes("pass") ? "pass" : m.key.includes("rush") ? "rush" : "rec";
    const byPlayer = new Map<string, { over?: { price: number; point?: number }; under?: { price: number } }>();
    for (const o of m.outcomes) {
      const player = o.description ?? "";
      const e = byPlayer.get(player) ?? {};
      if (o.name === "Over") e.over = { price: o.price, point: o.point };
      else e.under = { price: o.price };
      byPlayer.set(player, e);
    }
    for (const [player, e] of byPlayer) {
      if (e.over?.point != null) {
        lines.push({ player, market, line: e.over.point, overPrice: e.over.price, underPrice: e.under?.price ?? null });
      }
    }
  }
  propCache.set(eventId, { lines, at: Date.now() });
  return lines;
}

function normCdfOver(mu: number, sd: number, line: number): number {
  const z = (mu - line) / sd;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  let p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  if (z > 0) p = 1 - p;
  return p;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const homeId = String(body.homeId ?? "");
    const awayId = String(body.awayId ?? "");
    const eventId = body.eventId ? String(body.eventId) : null;
    const options: EngineOptions = {
      adjustments: Array.isArray(body.adjustments) ? (body.adjustments as RatingAdjustment[]) : [],
      decidedGames: Array.isArray(body.decidedGames) ? (body.decidedGames as DecidedGame[]) : [],
      qbOverrides:
        body.qbOverrides && typeof body.qbOverrides === "object"
          ? (body.qbOverrides as Record<string, string>)
          : {},
    };
    const engine = await getEngine(options);
    if (engine.sim.index[homeId] == null || engine.sim.index[awayId] == null) {
      return NextResponse.json({ error: "unknown team" }, { status: 400 });
    }
    const proj = projectGame(homeId, awayId, engine.units);

    // Live FD prop lines (on demand) matched to projections by player name.
    const lines = eventId ? await fetchProps(eventId) : null;
    const projByName = new Map(proj.players.map((p) => [p.name.toLowerCase(), p]));
    const edges = (lines ?? [])
      .map((l) => {
        const p = projByName.get(l.player.toLowerCase());
        if (!p) return null;
        const mu = l.market === "pass" ? p.projPassYds : l.market === "rush" ? p.projRushYds : p.projRecYds;
        if (mu == null) return null;
        const pOver = normCdfOver(mu, propSd(mu, l.market), l.line);
        const evOver = pOver * americanToDecimal(l.overPrice) - 1;
        const evUnder = l.underPrice != null ? (1 - pOver) * americanToDecimal(l.underPrice) - 1 : null;
        return {
          player: l.player,
          team: p.team,
          market: l.market,
          line: l.line,
          proj: mu,
          pOver,
          overPrice: l.overPrice,
          underPrice: l.underPrice,
          evOver,
          evUnder,
          impliedOver: americanToImplied(l.overPrice),
        };
      })
      .filter(Boolean) as {
      player: string; team: string; market: string; line: number; proj: number;
      pOver: number; overPrice: number; underPrice: number | null;
      evOver: number; evUnder: number | null; impliedOver: number;
    }[];
    edges.sort((a, b) => Math.max(b.evOver, b.evUnder ?? -9) - Math.max(a.evOver, a.evUnder ?? -9));

    // Suggested SGPs: correlated MC over (score, team volume, player noise).
    const rnd = mulberry32(4242);
    const gauss = () => {
      const u = Math.max(1e-12, rnd());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
    };
    type Leg = { label: string; team: string; kind: "ml" | "over" | "under"; mu?: number; sd?: number; line?: number };
    const priceCombo = (legs: Leg[]) => {
      const N = 30000;
      let hit = 0;
      for (let s = 0; s < N; s++) {
        const hs = proj.muHome + gauss() * 9.5;
        const as = proj.muAway + gauss() * 9.5;
        const fHome = 0.7 + 0.3 * (hs / proj.muHome);
        const fAway = 0.7 + 0.3 * (as / proj.muAway);
        let all = true;
        for (const leg of legs) {
          let ok: boolean;
          if (leg.kind === "ml") ok = leg.team === homeId ? hs > as : as > hs;
          else {
            const f = leg.team === homeId ? fHome : fAway;
            const v = (leg.mu ?? 0) * f * (1 + gauss() * 0.3);
            ok = leg.kind === "over" ? v > (leg.line ?? 0) : v < (leg.line ?? 0);
          }
          if (!ok) {
            all = false;
            break;
          }
        }
        if (all) hit++;
      }
      return hit / N;
    };

    const suggestions = [];
    const favId = proj.muHome >= proj.muAway ? homeId : awayId;
    const top = edges.filter((e) => e.evOver > 0.02).slice(0, 4);
    if (top.length >= 1) {
      const combos: { name: string; legs: Leg[] }[] = [];
      const mkLeg = (e: (typeof top)[number]): Leg => ({
        label: `${e.player} over ${e.line} ${e.market} yds`,
        team: e.team,
        kind: "over",
        mu: e.proj,
        sd: propSd(e.proj, e.market as "pass"),
        line: e.line,
      });
      combos.push({
        name: "Script: favorite + best prop",
        legs: [{ label: `${favId} ML`, team: favId, kind: "ml" }, mkLeg(top[0])],
      });
      const qb = top.find((e) => e.market === "pass");
      const rec = top.find((e) => e.market === "rec" && e.team === qb?.team);
      if (qb && rec) combos.push({ name: "Stack: QB + his receiver", legs: [mkLeg(qb), mkLeg(rec)] });
      if (top.length >= 2) combos.push({ name: "Value pair", legs: [mkLeg(top[0]), mkLeg(top[1])] });
      for (const c of combos) {
        const p = priceCombo(c.legs);
        suggestions.push({ name: c.name, legs: c.legs.map((l) => l.label), jointProb: p, fairAmerican: probToAmerican(p) });
      }
    }

    // No live prop lines? Suggest parlays purely from the model, at
    // model-chosen "comfort lines" (~15% under projection → each leg lands
    // roughly 60-65%). The user checks FanDuel's quote against our fair price.
    if (suggestions.length === 0) {
      const dogId = favId === homeId ? awayId : homeId;
      const r5 = (v: number) => Math.max(5, Math.round((v * 0.85) / 5) * 5);
      const byTeam = (team: string) => proj.players.filter((p) => p.team === team);
      const qbOf = (team: string) => byTeam(team).find((p) => p.projPassYds);
      const wrOf = (team: string) =>
        byTeam(team).filter((p) => p.projRecYds).sort((a, b) => b.projRecYds! - a.projRecYds!)[0];
      const rbOf = (team: string) =>
        byTeam(team).filter((p) => p.projRushYds).sort((a, b) => b.projRushYds! - a.projRushYds!)[0];
      const over = (team: string, name: string, mu: number, stat: "pass" | "rush" | "rec"): Leg => ({
        label: `${name} over ${r5(mu)} ${stat} yds`,
        team,
        kind: "over",
        mu,
        sd: propSd(mu, stat),
        line: r5(mu),
      });
      const favQb = qbOf(favId);
      const favWr = wrOf(favId);
      const favRb = rbOf(favId);
      const dogQb = qbOf(dogId);
      const combos: { name: string; legs: Leg[] }[] = [];
      if (favQb?.projPassYds && favWr?.projRecYds) {
        combos.push({
          name: "Game script",
          legs: [
            { label: `${favId} ML`, team: favId, kind: "ml" },
            over(favId, favQb.name, favQb.projPassYds, "pass"),
            over(favId, favWr.name, favWr.projRecYds, "rec"),
          ],
        });
      }
      if (favRb?.projRushYds) {
        combos.push({
          name: "Ground control",
          legs: [
            { label: `${favId} ML`, team: favId, kind: "ml" },
            over(favId, favRb.name, favRb.projRushYds, "rush"),
          ],
        });
      }
      if (favQb?.projPassYds && dogQb?.projPassYds) {
        combos.push({
          name: "Shootout",
          legs: [
            over(favId, favQb.name, favQb.projPassYds, "pass"),
            over(dogId, dogQb.name, dogQb.projPassYds, "pass"),
          ],
        });
      }
      for (const c of combos) {
        const p = priceCombo(c.legs);
        suggestions.push({ name: c.name, legs: c.legs.map((l) => l.label), jointProb: p, fairAmerican: probToAmerican(p) });
      }
      suggestions.sort((a, b) => b.jointProb - a.jointProb);
    }

    return NextResponse.json({
      muHome: Math.round(proj.muHome * 10) / 10,
      muAway: Math.round(proj.muAway * 10) / 10,
      projections: proj.players.filter((p) => p.projPassYds || p.projRecYds || (p.projRushYds ?? 0) > 20),
      liveProps: lines != null,
      edges: edges.slice(0, 12),
      suggestions,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "studio failed" },
      { status: 500 },
    );
  }
}
