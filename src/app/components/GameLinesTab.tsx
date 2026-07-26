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
  const [sgpFor, setSgpFor] = useState<string | null>(null);
  const [picks, setPicks] = useState<SgpComponent[]>([]);
  const [sgpQuote, setSgpQuote] = useState("");
  const [sgp, setSgp] = useState<SgpResult | null>(null);
  const [sgpLoading, setSgpLoading] = useState(false);

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

  const evCls = (ev: number | null) =>
    ev == null ? "text-ink-3" : ev > 0.03 ? "font-bold text-up" : ev > 0 ? "text-up/80" : "text-ink-3";
  const fmtEv = (ev: number | null) => (ev == null ? "—" : `${ev > 0 ? "+" : ""}${fmtPct(ev, 1)}`);

  return (
    <div className="space-y-3">
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
            {games.map((g) => (
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
                    <div className="flex flex-wrap items-center gap-1.5 font-sans">
                      {([
                        { label: `${g.homeId} ML`, c: { type: "ml", side: "home" } as SgpComponent },
                        { label: `${g.awayId} ML`, c: { type: "ml", side: "away" } as SgpComponent },
                        ...(g.fd?.spreadHome != null
                          ? [
                              { label: `${g.homeId} ${g.fd.spreadHome > 0 ? "+" : ""}${g.fd.spreadHome}`, c: { type: "spread", side: "home", line: g.fd.spreadHome } as SgpComponent },
                              { label: `${g.awayId} ${-g.fd.spreadHome > 0 ? "+" : ""}${-g.fd.spreadHome}`, c: { type: "spread", side: "away", line: g.fd.spreadHome } as SgpComponent },
                            ]
                          : []),
                        ...(g.fd?.totalLine != null
                          ? [
                              { label: `Over ${g.fd.totalLine}`, c: { type: "total", side: "over", line: g.fd.totalLine } as SgpComponent },
                              { label: `Under ${g.fd.totalLine}`, c: { type: "total", side: "under", line: g.fd.totalLine } as SgpComponent },
                            ]
                          : []),
                      ]).map((opt) => {
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
                      <input
                        value={sgpQuote}
                        onChange={(e) => setSgpQuote(e.target.value)}
                        placeholder="FD SGP quote"
                        className="tnum w-24 rounded-lg border border-line bg-bg px-2 py-1 font-mono text-[11px] text-ink"
                      />
                      <button
                        onClick={() => priceSgp(g)}
                        disabled={picks.length === 0 || sgpLoading}
                        className="rounded-lg bg-warn/90 px-3 py-1 text-[11px] font-bold text-[#2a1f03] disabled:opacity-40"
                      >
                        {sgpLoading ? "…" : "Price it"}
                      </button>
                      {sgp && (
                        <span className="tnum font-mono text-[11px] text-ink-2">
                          model score {sgp.muHome.toFixed(0)}–{sgp.muAway.toFixed(0)} · joint{" "}
                          <b className="text-ink">{fmtPct(sgp.jointProb, 1)}</b> · fair{" "}
                          <b className="text-ink">{sgp.fairAmerican > 0 ? "+" : ""}{sgp.fairAmerican}</b> · corr{" "}
                          {sgp.correlation.toFixed(2)}×
                          {sgp.evAtQuote != null && (
                            <b className={sgp.evAtQuote >= 0 ? "text-up" : "text-down"}>
                              {" "}· EV {sgp.evAtQuote >= 0 ? "+" : ""}{fmtPct(sgp.evAtQuote, 1)} {sgp.evAtQuote >= 0 ? "BET" : "PASS"}
                            </b>
                          )}
                        </span>
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
