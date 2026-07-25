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
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
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
              </tr>
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
