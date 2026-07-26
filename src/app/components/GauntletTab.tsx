"use client";

import { useEffect, useState } from "react";
import { fmtPct } from "@/lib/format";
import type { Adjustment, QbOverrides } from "../clientTypes";
import type { DecidedGame } from "./FindTab";
import { Card, EmptyState, SectionTitle, Skeleton } from "./ui";

interface Cell {
  week: number;
  opp: string;
  home: boolean;
  pWin: number;
  result: "W" | "L" | null;
}
interface Row {
  id: string;
  name: string;
  conference: string;
  division: string;
  projWins: number;
  cells: (Cell | null)[];
}

export function GauntletTab({
  adjustments,
  decidedGames,
  qbOverrides,
}: {
  adjustments: Adjustment[];
  decidedGames: DecidedGame[];
  qbOverrides: QbOverrides;
}) {
  const [data, setData] = useState<{ weeks: number[]; rows: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conf, setConf] = useState<"ALL" | "AFC" | "NFC">("ALL");
  const [division, setDivision] = useState<string>("ALL");

  useEffect(() => {
    fetch("/api/gauntlet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adjustments, decidedGames, qbOverrides }),
    })
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError("Failed to load gauntlet"));
  }, [adjustments, decidedGames, qbOverrides]);

  if (error) return <EmptyState>{error}</EmptyState>;
  if (!data) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-3">
      <Card className="overflow-x-auto p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>The gauntlet — every game, the model's win probability</SectionTitle>
          <div className="flex gap-1">
            {(["ALL", "AFC", "NFC"] as const).map((c) => (
              <button
                key={c}
                onClick={() => { setConf(c); setDivision("ALL"); }}
                className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${conf === c ? "border-brand/60 bg-brand/10 text-brand" : "border-line text-ink-3"}`}
              >
                {c}
              </button>
            ))}
            {conf !== "ALL" &&
              ["ALL", "East", "North", "South", "West"].map((d) => (
                <button
                  key={d}
                  onClick={() => setDivision(d)}
                  className={`rounded-lg border px-2 py-1 text-[10px] font-semibold ${division === d ? "border-up-dim/60 bg-up/10 text-up" : "border-line text-ink-3"}`}
                >
                  {d}
                </button>
              ))}
          </div>
        </div>
        <table className="tnum mt-3 border-separate border-spacing-px font-mono text-[10px]">
          <thead>
            <tr className="text-[9px] font-bold uppercase text-ink-3">
              <th className="pr-2 text-left font-sans">Team</th>
              <th className="pr-2 text-right">Proj</th>
              {data.weeks.map((w) => (
                <th key={w} className="w-9 text-center">{w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows
              .filter((r) => (conf === "ALL" || r.conference === conf) && (division === "ALL" || r.division === division))
              .map((r) => (
              <tr key={r.id}>
                <td className="sticky left-0 z-10 whitespace-nowrap bg-surface pr-2 font-sans text-xs font-semibold text-ink" title={`${r.name} · ${r.conference} ${r.division}`}>{r.id}</td>
                <td className="pr-2 text-right text-ink-2">{r.projWins.toFixed(1)}</td>
                {r.cells.map((c, i) =>
                  c == null ? (
                    <td key={i} className="h-8 w-9 rounded bg-surface-2 text-center text-ink-3/40">bye</td>
                  ) : (
                    <td
                      key={i}
                      className="h-8 w-9 rounded text-center"
                      style={{
                        background:
                          c.result === "W"
                            ? "var(--color-chart-green)"
                            : c.result === "L"
                              ? "var(--color-chart-red)"
                              : c.pWin >= 0.5
                                ? `color-mix(in oklab, var(--color-chart-green) ${(c.pWin - 0.5) * 170}%, var(--color-bg))`
                                : `color-mix(in oklab, var(--color-chart-red) ${(0.5 - c.pWin) * 170}%, var(--color-bg))`,
                        color: c.result ? "#fff" : "var(--color-ink-2)",
                        outline: c.home ? undefined : "1px solid var(--color-line-2)",
                      }}
                      title={`Wk ${c.week}: ${c.home ? "vs" : "@"} ${c.opp} — ${fmtPct(c.pWin, 0)} to win${c.result ? ` · final: ${c.result}` : ""}`}
                    >
                      <div className="leading-3">
                        <div>{c.result ?? `${c.home ? "" : "@"}${c.opp}`}</div>
                        {!c.result && <div className="text-[8px] opacity-80">{Math.round(c.pWin * 100)}%</div>}
                      </div>
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          <span className="font-semibold text-up">Green</span> = favored,{" "}
          <span className="font-semibold text-down">red</span> = underdog (deeper = stronger);
          outlined cells are road games; solid W/L are played results. Hover any cell for the
          number. Brutal stretches and soft landings jump out — useful for timing win-total bets
          and spotting schedule-mirage teams. Rows sorted by projected wins; rest effects and your
          QB/injury settings are included.
        </p>
      </Card>
    </div>
  );
}
