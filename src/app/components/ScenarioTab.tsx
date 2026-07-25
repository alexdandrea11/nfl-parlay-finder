"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtPct } from "@/lib/format";
import type { Adjustment, QbOverrides, ScheduledGame } from "../clientTypes";
import type { DecidedGame } from "./FindTab";
import { Card, EmptyState, SectionTitle, Skeleton } from "./ui";

interface TeamStat {
  id: string;
  name: string;
  meanWins: number;
  pPlayoffs: number;
  pDivision: number;
  pSb: number;
}

export function ScenarioTab({
  schedule,
  adjustments,
  decidedGames,
  qbOverrides,
}: {
  schedule: ScheduledGame[];
  adjustments: Adjustment[];
  decidedGames: DecidedGame[];
  qbOverrides: QbOverrides;
}) {
  const [scenario, setScenario] = useState<DecidedGame[]>([]);
  const [week, setWeek] = useState(1);
  const [data, setData] = useState<{ baseline: TeamStat[]; scenario: TeamStat[] } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      fetch("/api/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustments, decidedGames, qbOverrides, scenarioGames: scenario }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (!d.error) setData(d);
        })
        .finally(() => setLoading(false));
    }, 350); // debounce rapid toggling
    return () => clearTimeout(t);
  }, [scenario, adjustments, decidedGames, qbOverrides]);

  const weeks = useMemo(() => [...new Set(schedule.map((g) => g.week))].sort((a, b) => a - b), [schedule]);
  const weekGames = schedule.filter((g) => g.week === week);
  const decidedKeys = new Set(decidedGames.map((g) => `${g.homeId}|${g.awayId}`));

  function toggle(g: ScheduledGame, winnerId: string) {
    const existing = scenario.find((s) => s.homeId === g.home && s.awayId === g.away);
    if (existing?.winnerId === winnerId) {
      setScenario(scenario.filter((s) => s !== existing));
    } else {
      setScenario([
        ...scenario.filter((s) => s !== existing),
        { homeId: g.home, awayId: g.away, winnerId },
      ]);
    }
  }

  const deltas = useMemo(() => {
    if (!data) return [];
    const base = new Map(data.baseline.map((t) => [t.id, t]));
    return data.scenario
      .map((t) => {
        const b = base.get(t.id)!;
        return {
          ...t,
          dWins: t.meanWins - b.meanWins,
          dPlayoffs: t.pPlayoffs - b.pPlayoffs,
          dDivision: t.pDivision - b.pDivision,
          dSb: t.pSb - b.pSb,
          basePlayoffs: b.pPlayoffs,
        };
      })
      .sort((a, b) => Math.abs(b.dPlayoffs) - Math.abs(a.dPlayoffs));
  }, [data]);

  const affected = deltas.filter((d) => Math.abs(d.dPlayoffs) > 0.001 || Math.abs(d.dWins) > 0.02);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
      {/* Scenario builder */}
      <Card className="space-y-3 p-4 lg:sticky lg:top-28 lg:self-start">
        <div className="flex items-center justify-between">
          <SectionTitle>What if… · pick hypothetical results</SectionTitle>
          {scenario.length > 0 && (
            <button
              onClick={() => setScenario([])}
              className="text-[11px] font-medium text-down underline-offset-2 hover:underline"
            >
              Clear ({scenario.length})
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {weeks.map((w) => {
            const marked = schedule.filter(
              (g) => g.week === w && scenario.some((s) => s.homeId === g.home && s.awayId === g.away),
            ).length;
            return (
              <button
                key={w}
                onClick={() => setWeek(w)}
                className={`tnum rounded-md border px-1.5 py-1 font-mono text-[10px] font-bold transition-colors ${
                  week === w
                    ? "border-brand/60 bg-brand/10 text-brand"
                    : marked
                      ? "border-warn/50 text-warn"
                      : "border-line text-ink-3 hover:border-line-2"
                }`}
              >
                {w}
              </button>
            );
          })}
        </div>
        <div className="space-y-1">
          {weekGames.map((g) => {
            const hyp = scenario.find((s) => s.homeId === g.home && s.awayId === g.away);
            const isReal = decidedKeys.has(`${g.home}|${g.away}`);
            const side = (id: string) => (
              <button
                onClick={() => toggle(g, id)}
                disabled={isReal}
                className={`tnum w-14 rounded-md border px-1.5 py-1 font-mono text-[11px] font-bold transition-colors disabled:opacity-30 ${
                  hyp?.winnerId === id
                    ? "border-warn/70 bg-warn/15 text-warn"
                    : hyp
                      ? "border-line text-ink-3/50 line-through"
                      : "border-line text-ink-2 hover:border-line-2 hover:text-ink"
                }`}
              >
                {id}
              </button>
            );
            return (
              <div key={`${g.home}${g.away}`} className="flex items-center gap-1.5 text-[11px] text-ink-3">
                {side(g.away)}
                <span>@</span>
                {side(g.home)}
                {isReal && <span className="text-[9px] uppercase">played</span>}
              </div>
            );
          })}
        </div>
        <p className="text-[10px] leading-relaxed text-ink-3">
          Amber picks are hypothetical — they re-simulate all 20,000 seasons on top of real
          results. Already-played games are locked.
        </p>
      </Card>

      {/* Impact */}
      <div className="space-y-3">
        {scenario.length === 0 ? (
          <EmptyState>
            Pick a hypothetical result on the left — "what if the Bills sweep the Chiefs?" — and
            watch every team's playoff, division, and Super Bowl odds shift in response. Great for
            deciding whether a future bet survives the scenarios you're worried about.
          </EmptyState>
        ) : !data ? (
          <Skeleton className="h-64" />
        ) : (
          <Card className={`overflow-x-auto p-5 ${loading ? "opacity-60" : ""} transition-opacity`}>
            <SectionTitle>
              Impact of {scenario.length} hypothetical result{scenario.length > 1 ? "s" : ""}
            </SectionTitle>
            <table className="tnum mt-3 w-full min-w-[640px] font-mono text-xs">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-ink-3">
                  <th className="py-1.5">Team</th>
                  <th className="py-1.5 text-right">Δ wins</th>
                  <th className="py-1.5 text-right">Playoffs</th>
                  <th className="py-1.5 text-right">Δ</th>
                  <th className="py-1.5 text-right">Δ division</th>
                  <th className="py-1.5 text-right">Δ Super Bowl</th>
                </tr>
              </thead>
              <tbody>
                {affected.slice(0, 14).map((t) => {
                  const cls = (v: number) =>
                    v > 0.001 ? "text-up" : v < -0.001 ? "text-down" : "text-ink-3";
                  const pp = (v: number) =>
                    `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}pp`;
                  return (
                    <tr key={t.id} className="border-t border-line/60">
                      <td className="py-1.5 font-sans text-[13px] font-semibold text-ink">{t.name}</td>
                      <td className={`py-1.5 text-right ${cls(t.dWins)}`}>
                        {t.dWins > 0 ? "+" : ""}
                        {t.dWins.toFixed(2)}
                      </td>
                      <td className="py-1.5 text-right text-ink-2">
                        {fmtPct(t.basePlayoffs, 0)} → {fmtPct(t.pPlayoffs, 0)}
                      </td>
                      <td className={`py-1.5 text-right font-bold ${cls(t.dPlayoffs)}`}>{pp(t.dPlayoffs)}</td>
                      <td className={`py-1.5 text-right ${cls(t.dDivision)}`}>{pp(t.dDivision)}</td>
                      <td className={`py-1.5 text-right ${cls(t.dSb)}`}>{pp(t.dSb)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {affected.length === 0 && (
              <p className="mt-3 text-sm text-ink-2">No meaningful probability shifts from this scenario.</p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
