"use client";

import { useEffect, useState } from "react";
import { fmtAmerican, fmtPct } from "@/lib/format";
import type { Adjustment, QbOverrides } from "../clientTypes";
import type { DecidedGame } from "./FindTab";
import { Card, EmptyState, SectionTitle, Skeleton } from "./ui";

interface FdLine {
  mlHome: number | null;
  mlAway: number | null;
  spreadHome: number | null;
  spreadHomePrice: number | null;
  spreadAwayPrice: number | null;
  totalLine: number | null;
  overPrice: number | null;
  underPrice: number | null;
}

interface SgpComponent {
  type: "ml" | "spread" | "total";
  side: "home" | "away" | "over" | "under";
  line?: number;
}

interface StudioResult {
  muHome: number;
  muAway: number;
  liveProps: boolean;
  projections: { name: string; pos: string; team: string; projPassYds: number | null; projRushYds: number | null; projRecYds: number | null }[];
  edges: { player: string; team: string; market: string; line: number; proj: number; overPrice: number; underPrice: number | null; evOver: number; evUnder: number | null }[];
  suggestions: { name: string; legs: string[]; jointProb: number; fairAmerican: number }[];
}

interface SgpResult {
  muHome: number;
  muAway: number;
  jointProb: number;
  independentProb: number;
  correlation: number;
  fairAmerican: number;
  evAtQuote: number | null;
}

interface GameRow {
  eventId: string;
  commence: string;
  week: number | null;
  homeId: string;
  awayId: string;
  modelPHome: number;
  modelMargin: number;
  mktPHome: number | null;
  fd: FdLine | null;
  bookCount: number;
  evMlHome: number | null;
  evMlAway: number | null;
  pCoverHome: number | null;
  evSpreadHome: number | null;
  evSpreadAway: number | null;
}

export function GameLinesTab({
  adjustments,
  decidedGames,
  qbOverrides,
}: {
  adjustments: Adjustment[];
  decidedGames: DecidedGame[];
  qbOverrides: QbOverrides;
}) {
  const [games, setGames] = useState<GameRow[] | null>(null);
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [sgpFor, setSgpFor] = useState<string | null>(null);
  const [picks, setPicks] = useState<SgpComponent[]>([]);
  const [sgpQuote, setSgpQuote] = useState("");
  const [sgp, setSgp] = useState<SgpResult | null>(null);
  const [sgpLoading, setSgpLoading] = useState(false);
  const [studio, setStudio] = useState<StudioResult | null>(null);
  const [studioLoading, setStudioLoading] = useState(false);

  async function runStudio(g: GameRow) {
    setStudioLoading(true);
    setStudio(null);
    try {
      const res = await fetch("/api/sgpstudio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeId: g.homeId,
          awayId: g.awayId,
          eventId: g.eventId,
          adjustments,
          decidedGames,
          qbOverrides,
        }),
      });
      const d = await res.json();
      if (!d.error) setStudio(d);
    } finally {
      setStudioLoading(false);
    }
  }

  function togglePick(c: SgpComponent) {
    setSgp(null);
    setPicks((prev) => {
      const match = prev.find((p) => p.type === c.type);
      const same = match && match.side === c.side;
      const rest = prev.filter((p) => p.type !== c.type);
      return same ? rest : [...rest, c]; // one pick per market type
    });
  }

  async function priceSgp(g: GameRow) {
    if (picks.length === 0) return;
    setSgpLoading(true);
    try {
      const res = await fetch("/api/sgp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeId: g.homeId,
          awayId: g.awayId,
          components: picks,
          quotedAmerican: sgpQuote ? Number(sgpQuote.replace("+", "")) : null,
          adjustments,
          decidedGames,
          qbOverrides,
        }),
      });
      const d = await res.json();
      if (!d.error) setSgp(d);
    } finally {
      setSgpLoading(false);
    }
  }

  useEffect(() => {
    fetch("/api/gamelines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adjustments, decidedGames, qbOverrides }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          setGames(d.games ?? []);
          setLive(Boolean(d.live));
        }
      })
      .catch(() => setError("Failed to load game lines"));
  }, [adjustments, decidedGames, qbOverrides]);

  if (error) return <EmptyState>{error}</EmptyState>;
  if (!games) return <Skeleton className="h-72" />;

  if (!live || games.length === 0) {
    return (
      <EmptyState>
        No game lines available right now{!live && " (live odds feed inactive)"} — sportsbooks post
        weekly moneylines and spreads as game week approaches. This tab lights up automatically in
        season: the same matchup model that powers the futures sim prices every game, and any gap
        vs FanDuel's line shows here as a single-game edge.
      </EmptyState>
    );
  }

  const weeks = [...new Set(games.map((g) => g.week).filter((w): w is number => w != null))].sort(
    (a, b) => a - b,
  );
  const activeWeek = week ?? weeks[0] ?? null;
  const shown = activeWeek == null ? games : games.filter((g) => g.week === activeWeek);

  const evCls = (ev: number | null) =>
    ev == null ? "text-ink-3" : ev > 0.03 ? "font-bold text-up" : ev > 0 ? "text-up/80" : "text-ink-3";
  const fmtEv = (ev: number | null) => (ev == null ? "—" : `${ev > 0 ? "+" : ""}${fmtPct(ev, 1)}`);

  return (
    <div className="space-y-3">
      {weeks.length > 1 && (
        <Card className="flex flex-wrap items-center gap-1 p-3">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-ink-3">Week</span>
          {weeks.map((w) => (
            <button
              key={w}
              onClick={() => setWeek(w)}
              className={`tnum rounded-md border px-2 py-1 font-mono text-xs font-bold transition-colors ${
                activeWeek === w
                  ? "border-brand/60 bg-brand/10 text-brand"
                  : "border-line text-ink-3 hover:border-line-2"
              }`}
            >
              {w}
            </button>
          ))}
          <span className="tnum ml-2 font-mono text-[11px] text-ink-3">
            {shown.length} games
          </span>
        </Card>
      )}
      <Card className="overflow-x-auto">
        <table className="tnum w-full min-w-[900px] font-mono text-xs">
          <thead className="bg-surface-2">
            <tr className="border-b border-line text-left text-[10px] font-bold uppercase tracking-wider text-ink-3">
              <th className="px-3.5 py-2.5">Game</th>
              <th className="px-2.5 py-2.5 text-right">Model home win</th>
              <th className="px-2.5 py-2.5 text-right">Market</th>
              <th className="px-2.5 py-2.5 text-right">Model line</th>
              <th className="px-2.5 py-2.5 text-right">FD line</th>
              <th className="px-2.5 py-2.5 text-right">EV ML home</th>
              <th className="px-2.5 py-2.5 text-right">EV ML away</th>
              <th className="px-2.5 py-2.5 text-right">EV spread H</th>
              <th className="px-2.5 py-2.5 text-right">EV spread A</th>
              <th className="px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {shown.map((g) => (
              <>
              <tr key={g.eventId} className="border-b border-line/60 transition-colors hover:bg-surface-2">
                <td className="px-3.5 py-2 font-sans text-[13px]">
                  <b>{g.awayId}</b> @ <b>{g.homeId}</b>
                  <span className="ml-2 text-[10px] text-ink-3">
                    {new Date(g.commence).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </td>
                <td className="px-2.5 py-2 text-right text-ink">{fmtPct(g.modelPHome, 0)}</td>
                <td className="px-2.5 py-2 text-right text-ink-3">
                  {g.mktPHome != null ? fmtPct(g.mktPHome, 0) : "—"}
                </td>
                <td className="px-2.5 py-2 text-right text-ink-2" title="Model expected home margin — negative means home favored by that many">
                  {g.modelMargin > 0 ? `H -${g.modelMargin.toFixed(1)}` : `A -${(-g.modelMargin).toFixed(1)}`}
                </td>
                <td className="px-2.5 py-2 text-right text-brand">
                  {g.fd?.spreadHome != null ? `H ${g.fd.spreadHome > 0 ? "+" : ""}${g.fd.spreadHome}` : "—"}
                  {g.fd?.mlHome != null && (
                    <span className="ml-1.5 text-ink-3">{fmtAmerican(g.fd.mlHome)}</span>
                  )}
                </td>
                <td className={`px-2.5 py-2 text-right ${evCls(g.evMlHome)}`}>{fmtEv(g.evMlHome)}</td>
                <td className={`px-2.5 py-2 text-right ${evCls(g.evMlAway)}`}>{fmtEv(g.evMlAway)}</td>
                <td className={`px-2.5 py-2 text-right ${evCls(g.evSpreadHome)}`} title={g.pCoverHome != null ? `model: home covers ${fmtPct(g.pCoverHome, 0)}` : undefined}>
                  {fmtEv(g.evSpreadHome)}
                </td>
                <td className={`px-2.5 py-2 text-right ${evCls(g.evSpreadAway)}`}>{fmtEv(g.evSpreadAway)}</td>
                <td className="px-2 py-2 text-right">
                  <button
                    onClick={() => {
                      setSgpFor(sgpFor === g.eventId ? null : g.eventId);
                      setPicks([]);
                      setSgp(null);
                      setSgpQuote("");
                    }}
                    className={`rounded-md border px-2 py-0.5 font-sans text-[10px] font-bold ${
                      sgpFor === g.eventId ? "border-warn/60 text-warn" : "border-line text-ink-3 hover:border-line-2"
                    }`}
                  >
                    SGP
                  </button>
                </td>
              </tr>
              {sgpFor === g.eventId && (
                <tr key={`${g.eventId}-sgp`}>
                  <td colSpan={10} className="bg-surface-2 px-3.5 py-3">
                    <div className="space-y-3 font-sans">
                      <div>
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
                          Build a same-game parlay · pick up to one per market
                        </p>
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                          {([
                            { grp: "Winner", opts: [
                              { label: g.homeId, c: { type: "ml", side: "home" } as SgpComponent },
                              { label: g.awayId, c: { type: "ml", side: "away" } as SgpComponent },
                            ]},
                            { grp: "Spread", opts: g.fd?.spreadHome != null ? [
                              { label: `${g.homeId} ${g.fd.spreadHome > 0 ? "+" : ""}${g.fd.spreadHome}`, c: { type: "spread", side: "home", line: g.fd.spreadHome } as SgpComponent },
                              { label: `${g.awayId} ${-g.fd.spreadHome > 0 ? "+" : ""}${-g.fd.spreadHome}`, c: { type: "spread", side: "away", line: g.fd.spreadHome } as SgpComponent },
                            ] : []},
                            { grp: "Total", opts: g.fd?.totalLine != null ? [
                              { label: `Over ${g.fd.totalLine}`, c: { type: "total", side: "over", line: g.fd.totalLine } as SgpComponent },
                              { label: `Under ${g.fd.totalLine}`, c: { type: "total", side: "under", line: g.fd.totalLine } as SgpComponent },
                            ] : []},
                          ]).map((grp) =>
                            grp.opts.length === 0 ? null : (
                              <span key={grp.grp} className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-ink-3">{grp.grp}</span>
                                {grp.opts.map((opt) => {
                                  const active = picks.some((p) => p.type === opt.c.type && p.side === opt.c.side);
                                  return (
                                    <button
                                      key={opt.label}
                                      onClick={() => togglePick(opt.c)}
                                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                                        active ? "border-warn/70 bg-warn/15 text-warn" : "border-line text-ink-2 hover:border-line-2"
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </span>
                            ),
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => priceSgp(g)}
                          disabled={picks.length === 0 || sgpLoading}
                          className="rounded-lg bg-warn/90 px-3.5 py-1.5 text-[11px] font-bold text-[#2a1f03] disabled:opacity-40"
                        >
                          {sgpLoading ? "Pricing…" : "Price my picks"}
                        </button>
                        <span className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-ink-3">FD quotes</span>
                          <input
                            value={sgpQuote}
                            onChange={(e) => setSgpQuote(e.target.value)}
                            placeholder="+400"
                            className="tnum w-16 bg-transparent font-mono text-[11px] text-ink outline-none placeholder:text-ink-3/50"
                          />
                        </span>
                        <button
                          onClick={() => runStudio(g)}
                          disabled={studioLoading}
                          className="rounded-lg border border-warn/50 px-3.5 py-1.5 text-[11px] font-bold text-warn disabled:opacity-40"
                        >
                          {studioLoading ? "Projecting…" : "✨ Studio: project players & suggest combos"}
                        </button>
                      </div>

                      {sgp && (
                        <div className="flex flex-wrap items-center gap-x-7 gap-y-2 rounded-lg border border-line bg-bg px-4 py-2.5">
                          {([
                            ["Model score", `${g.homeId} ${sgp.muHome.toFixed(0)} — ${sgp.muAway.toFixed(0)} ${g.awayId}`],
                            ["Chance all hit", fmtPct(sgp.jointProb, 1)],
                            ["Fair price", `${sgp.fairAmerican > 0 ? "+" : ""}${sgp.fairAmerican}`],
                            ["Correlation", `${sgp.correlation.toFixed(2)}×`],
                          ] as const).map(([label, value]) => (
                            <span key={label}>
                              <span className="block text-[9px] font-bold uppercase tracking-wider text-ink-3">{label}</span>
                              <span className="tnum font-mono text-sm font-bold text-ink">{value}</span>
                            </span>
                          ))}
                          {sgp.evAtQuote != null && (
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-extrabold ${
                                sgp.evAtQuote >= 0 ? "bg-up/15 text-up" : "bg-down/15 text-down"
                              }`}
                            >
                              {sgp.evAtQuote >= 0 ? "BET" : "PASS"} · EV {(sgp.evAtQuote * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      )}

                      {studio && sgpFor === g.eventId && (
                        <div className="space-y-3 border-t border-line pt-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="tnum rounded-lg bg-bg px-3 py-1.5 font-mono text-sm font-bold text-ink">
                              {g.homeId} {studio.muHome.toFixed(0)} — {studio.muAway.toFixed(0)} {g.awayId}
                            </span>
                            <span className="text-[11px] text-ink-3">
                              model expected score{!studio.liveProps && " · FanDuel prop lines not posted yet — projections only"}
                            </span>
                          </div>
                          {studio.suggestions.length > 0 && (
                            <div>
                              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">Suggested combos</p>
                              <div className="grid gap-1.5 md:grid-cols-3">
                                {studio.suggestions.map((s) => (
                                  <div key={s.name} className="rounded-lg border border-warn/25 bg-bg p-2.5">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-warn">{s.name}</p>
                                    <p className="mt-1 text-xs leading-relaxed text-ink">{s.legs.join(" + ")}</p>
                                    <p className="tnum mt-1 font-mono text-[11px] text-ink-2">
                                      {(s.jointProb * 100).toFixed(1)}% to hit · fair {s.fairAmerican > 0 ? "+" : ""}{s.fairAmerican}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {studio.edges.length > 0 && (
                            <div>
                              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">Prop edges vs FanDuel lines</p>
                              <table className="tnum w-full max-w-2xl font-mono text-[11px]">
                                <thead>
                                  <tr className="text-left text-[9px] uppercase text-ink-3">
                                    <th className="py-1 font-sans">Player</th>
                                    <th className="font-sans">Market</th>
                                    <th className="text-right font-sans">FD line</th>
                                    <th className="text-right font-sans">Our proj</th>
                                    <th className="text-right font-sans">Play</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {studio.edges.slice(0, 8).map((e, i) => {
                                    const over = e.evOver > (e.evUnder ?? -9);
                                    const ev = over ? e.evOver : e.evUnder ?? 0;
                                    return (
                                      <tr key={i} className="border-t border-line/60">
                                        <td className="py-1 font-sans text-xs text-ink">{e.player}</td>
                                        <td className="font-sans text-xs text-ink-3">{e.market} yds</td>
                                        <td className="text-right">{e.line}</td>
                                        <td className={`text-right ${e.proj > e.line ? "text-up" : "text-down"}`}>{e.proj.toFixed(0)}</td>
                                        <td className={`text-right font-bold ${ev > 0.03 ? (over ? "text-up" : "text-down") : "text-ink-3"}`}>
                                          {over ? "OVER" : "UNDER"} {(ev * 100).toFixed(0)}%
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                          <div>
                            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">Model projections</p>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 md:grid-cols-4">
                              {studio.projections.slice(0, 16).map((p) => (
                                <span key={p.name} className="tnum font-mono text-[10px] text-ink-2">
                                  <span className="text-ink-3">{p.team}</span> {p.name.split(" ").slice(-1)[0]}:{" "}
                                  {p.projPassYds ? `${p.projPassYds} pass` : p.projRecYds ? `${p.projRecYds} rec` : `${p.projRushYds} rush`}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              </>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-[11px] leading-relaxed text-ink-3">
        Same engine as the futures sim — unit matchups, in-season blending, your QB swaps and
        injury adjustments — pointed at single games and compared to FanDuel's posted lines.{" "}
        <b className="text-up">Bright green</b> = EV above +3%. Single-game edges are smaller and
        more efficient markets than futures: treat anything under +2% as noise.
      </p>
    </div>
  );
}
