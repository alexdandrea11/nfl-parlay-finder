"use client";

import { useEffect, useState } from "react";
import { fmtAmerican, fmtPct } from "@/lib/format";
import type { Adjustment, QbOverrides } from "../clientTypes";
import type { DecidedGame } from "./FindTab";
import { Card, EmptyState, SectionTitle, Skeleton } from "./ui";

interface ComboRow {
  legs: string[];
  prob: number;
  american?: number;
  payout?: number;
  ev: number;
}

interface WeeklyData {
  weeks: number[];
  week: number | null;
  matchups: {
    gameKey: string; homeId: string; awayId: string; pHome: number;
    muHome: number; muAway: number; modelLine: number;
    fdSpread: number | null; fdTotal: number | null;
  }[];
  legs: { label: string; price: number; prob: number; ev: number }[];
  parlaysBySize: Record<number, ComboRow[]>;
  teaserOptions: Record<number, ComboRow[]>;
}

export function WeeklyTab({
  adjustments,
  decidedGames,
  qbOverrides,
}: {
  adjustments: Adjustment[];
  decidedGames: DecidedGame[];
  qbOverrides: QbOverrides;
}) {
  const [week, setWeek] = useState<number | null>(null);
  const [legCount, setLegCount] = useState(3);
  const [teaserN, setTeaserN] = useState(2);
  const [data, setData] = useState<WeeklyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/weekly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week, adjustments, decidedGames, qbOverrides }),
    })
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError("Failed to load weekly bets"))
      .finally(() => setLoading(false));
  }, [week, adjustments, decidedGames, qbOverrides]);

  if (error) return <EmptyState>{error}</EmptyState>;
  if (!data) return <Skeleton className="h-96" />;
  if (data.week == null)
    return (
      <EmptyState>
        No game lines posted yet — this tab builds each week's best cross-game parlays and
        6-point teasers the moment sportsbooks release lines.
      </EmptyState>
    );

  const parlays = data.parlaysBySize?.[legCount] ?? [];
  const teasers = data.teaserOptions?.[teaserN] ?? [];
  const sizeChip = (active: boolean) =>
    `tnum rounded-md border px-2.5 py-1 font-mono text-xs font-bold transition-colors ${
      active ? "border-warn/60 bg-warn/10 text-warn" : "border-line text-ink-3 hover:border-line-2"
    }`;

  return (
    <div className={`space-y-4 ${loading ? "opacity-60" : ""} transition-opacity`}>
      <Card className="flex flex-wrap items-center gap-1 p-3">
        <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-ink-3">Week</span>
        {data.weeks.map((w) => (
          <button
            key={w}
            onClick={() => setWeek(w)}
            className={`tnum rounded-md border px-2 py-1 font-mono text-xs font-bold transition-colors ${
              data.week === w ? "border-brand/60 bg-brand/10 text-brand" : "border-line text-ink-3 hover:border-line-2"
            }`}
          >
            {w}
          </button>
        ))}
      </Card>

      {/* Matchup board: the model's view of the slate */}
      <Card className="overflow-x-auto p-5">
        <SectionTitle>Week {data.week} — the model's view of every game</SectionTitle>
        <table className="tnum mt-3 w-full min-w-[680px] font-mono text-xs">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-ink-3">
              <th className="py-1.5">Game</th>
              <th className="py-1.5 text-right">Model score</th>
              <th className="py-1.5 text-right">Home win</th>
              <th className="py-1.5 text-right">Model line</th>
              <th className="py-1.5 text-right">FD line</th>
              <th className="py-1.5 text-right">Gap</th>
              <th className="py-1.5 text-right">FD total</th>
            </tr>
          </thead>
          <tbody>
            {data.matchups.map((m) => {
              const gap = m.fdSpread != null ? m.fdSpread - m.modelLine : null;
              return (
                <tr key={m.gameKey} className="border-t border-line/60 transition-colors hover:bg-surface-2">
                  <td className="py-1.5 font-sans text-[13px] text-ink">
                    <b>{m.awayId}</b> @ <b>{m.homeId}</b>
                  </td>
                  <td className="py-1.5 text-right text-ink-2">
                    {m.muHome.toFixed(0)}–{m.muAway.toFixed(0)}
                  </td>
                  <td className="py-1.5 text-right text-ink-2">{fmtPct(m.pHome, 0)}</td>
                  <td className="py-1.5 text-right text-ink">
                    H {m.modelLine > 0 ? "+" : ""}{m.modelLine.toFixed(1)}
                  </td>
                  <td className="py-1.5 text-right text-brand">
                    {m.fdSpread != null ? `H ${m.fdSpread > 0 ? "+" : ""}${m.fdSpread}` : "—"}
                  </td>
                  <td className={`py-1.5 text-right font-bold ${gap != null && Math.abs(gap) >= 2 ? "text-warn" : "text-ink-3"}`}>
                    {gap != null ? `${gap > 0 ? "+" : ""}${gap.toFixed(1)}` : "—"}
                  </td>
                  <td className="py-1.5 text-right text-ink-3">{m.fdTotal ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          Sorted by how competitive the model thinks the game is. <b>Gap</b> = FD's line minus
          ours in points — amber when we disagree by a field goal or more; those games are where
          the parlay and teaser legs below come from.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Parlays with leg-count picker */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>Best parlays · ranked by EV</SectionTitle>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-ink-3">Legs</span>
              {[2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setLegCount(n)} className={sizeChip(legCount === n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {parlays.map((p, i) => (
              <div key={i} className={`rounded-lg border bg-bg p-3 ${i === 0 ? "border-up-dim/60" : "border-line"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5 text-[13px] leading-snug text-ink">
                    {p.legs.map((l) => (
                      <div key={l}>{i === 0 && p.legs[0] === l ? "⭐ " : ""}{l}</div>
                    ))}
                  </div>
                  <div className="tnum shrink-0 text-right font-mono text-xs text-ink-3">
                    <div className="text-sm font-bold text-ink">{fmtAmerican(p.american!)}</div>
                    <div>{fmtPct(p.prob, 1)} to hit</div>
                    <div className={p.ev >= 0 ? "font-bold text-up" : "text-down"}>
                      EV {p.ev >= 0 ? "+" : ""}{fmtPct(p.ev, 1)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {parlays.length === 0 && <p className="text-sm text-ink-2">No {legCount}-leg combos clear the bar this week.</p>}
          </div>
        </Card>

        {/* Teasers with team-count picker */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>Best 6-point teasers</SectionTitle>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-ink-3">Teams</span>
              {[2, 3, 4].map((n) => (
                <button key={n} onClick={() => setTeaserN(n)} className={sizeChip(teaserN === n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {teasers.map((t, i) => (
              <div key={i} className={`rounded-lg border bg-bg p-3 ${i === 0 ? "border-warn/60" : "border-line"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5 text-[13px] leading-snug text-ink">
                    {t.legs.map((l) => (
                      <div key={l}>{i === 0 && t.legs[0] === l ? "⭐ " : ""}{l}</div>
                    ))}
                  </div>
                  <div className="tnum shrink-0 text-right font-mono text-xs text-ink-3">
                    <div className="text-sm font-bold text-ink">pays {fmtAmerican(t.payout!)}</div>
                    <div>{fmtPct(t.prob, 1)} to hit</div>
                    <div className={t.ev >= 0 ? "font-bold text-up" : "text-down"}>
                      EV {t.ev >= 0 ? "+" : ""}{fmtPct(t.ev, 1)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {teasers.length === 0 && <p className="text-sm text-ink-2">Not enough spread games for a {teaserN}-team teaser.</p>}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            Lines shown posted → teased (6 pts your way), payouts are typical FanDuel — verify the
            quote. Best value teases through both 3 and 7.
          </p>
        </Card>
      </div>

      {/* Single-leg board */}
      <Card className="p-5">
        <SectionTitle>Top single legs this week</SectionTitle>
        <div className="mt-2 grid gap-1 md:grid-cols-2">
          {data.legs.map((l, i) => (
            <div key={i} className="tnum flex items-center justify-between rounded-lg bg-bg px-3 py-1.5 font-mono text-xs">
              <span className="font-sans text-[13px] text-ink">{l.label}</span>
              <span className="text-ink-3">
                {fmtAmerican(l.price)} · {fmtPct(l.prob, 0)} ·{" "}
                <b className={l.ev > 0 ? "text-up" : "text-ink-3"}>
                  {l.ev > 0 ? "+" : ""}{fmtPct(l.ev, 1)}
                </b>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
