"use client";

import { useEffect, useState } from "react";
import { fmtAmerican, fmtPct } from "@/lib/format";
import type { Adjustment, CustomBoard, QbOverrides } from "../clientTypes";
import type { DecidedGame } from "./FindTab";
import { Card, EmptyState, SectionTitle, Skeleton, Stat } from "./ui";

interface StreetTeam {
  id: string;
  name: string;
  power: number;
  fpi: number | null;
  meanWins: number;
  fpiProjWins: number | null;
  pSb: number;
  mktSb: number | null;
  pPlayoffs: number;
  mktPlayoffs: number | null;
}

interface Outlier {
  id: string;
  label: string;
  market: string;
  source: "live" | "custom" | "sample";
  modelProb: number;
  marketProb: number;
  divergence: number;
  americanOdds: number;
  fairAmerican: number;
  legEv: number;
}

interface ScatterPoint {
  label: string;
  market: string;
  model: number;
  mkt: number;
  source: string;
}

interface StreetResponse {
  teams: StreetTeam[];
  experts: { source: string; season: number; updatedAt: string | null } | null;
  agreement: { powerVsFpi: number; winsVsFpi: number; winsGap: number };
  outliers: Outlier[];
  scatter: ScatterPoint[];
  sims: number;
}

const MARKET_COLOR: Record<string, string> = {
  superbowl: "var(--color-chart-blue)",
  conference: "var(--color-chart-blue)",
  division: "var(--color-chart-amber)",
  playoffs: "var(--color-chart-green)",
  winsOver: "var(--color-chart-red)",
  winsUnder: "var(--color-chart-red)",
};

export function StreetTab({
  adjustments,
  decidedGames,
  qbOverrides,
  customBoard,
}: {
  adjustments: Adjustment[];
  decidedGames: DecidedGame[];
  qbOverrides: QbOverrides;
  customBoard: CustomBoard;
}) {
  const [data, setData] = useState<StreetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/street", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adjustments, decidedGames, qbOverrides, customBoard }),
    })
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError("Failed to load comparison"));
  }, [adjustments, decidedGames, qbOverrides, customBoard]);

  if (error) return <EmptyState>{error}</EmptyState>;
  if (!data)
    return (
      <div className="space-y-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-72" />
      </div>
    );

  const ag = data.agreement;

  return (
    <div className="space-y-4">
      {/* Agreement headline */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>
            Sanity check — does the model live on the same planet as everyone else?
          </SectionTitle>
          {data.experts && (
            <span className="tnum font-mono text-[10px] text-ink-3">
              experts = {data.experts.source} {data.experts.season}
            </span>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-8">
          <Stat
            label="Power vs FPI correlation"
            value={ag.powerVsFpi.toFixed(2)}
            tone={ag.powerVsFpi > 0.7 ? "good" : ag.powerVsFpi > 0.4 ? "warn" : "bad"}
            size="xl"
          />
          <Stat
            label="Win proj vs FPI correlation"
            value={ag.winsVsFpi.toFixed(2)}
            tone={ag.winsVsFpi > 0.7 ? "good" : ag.winsVsFpi > 0.4 ? "warn" : "bad"}
            size="xl"
          />
          <Stat
            label="Avg win-total gap vs FPI"
            value={`${ag.winsGap.toFixed(1)} wins`}
            tone={ag.winsGap < 1.5 ? "good" : "warn"}
            size="xl"
          />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          High correlation = we broadly agree with the street and the experts, so the places we
          disagree are meaningful. Low correlation would mean the model is broken, not brilliant.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Scatter: model vs market */}
        <Card className="p-5">
          <SectionTitle>Every leg: our probability vs the street's</SectionTitle>
          <ScatterPlot points={data.scatter} />
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[--color-chart-blue]" /> SB / Conference
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[--color-chart-amber]" /> Division
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[--color-chart-green]" /> Playoffs
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[--color-chart-red]" /> Win totals
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            The diagonal is perfect agreement. Above it = we're higher than the street; below =
            lower. Points outside the shaded band (±10pp) are the outliers listed on the right.
          </p>
        </Card>

        {/* Outliers */}
        <Card className="p-5">
          <SectionTitle>Biggest disagreements — our outlier picks</SectionTitle>
          <div className="mt-3 space-y-1.5">
            {data.outliers.map((o) => {
              const higher = o.divergence > 0;
              return (
                <div key={o.id} className="rounded-lg bg-bg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 truncate text-[13px]">
                      {o.source !== "sample" && (
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${o.source === "live" ? "bg-up" : "bg-warn"}`}
                          title={o.source === "live" ? "Live price" : "Your entered price"}
                        />
                      )}
                      {o.label}
                    </span>
                    <span
                      className={`tnum shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
                        higher ? "bg-up/10 text-up" : "bg-down/10 text-down"
                      }`}
                    >
                      {higher ? "WE'RE HIGHER" : "WE'RE LOWER"} {fmtPct(Math.abs(o.divergence), 0)}
                    </span>
                  </div>
                  <div className="tnum mt-1 flex flex-wrap gap-x-4 font-mono text-[11px] text-ink-3">
                    <span>
                      model <b className="text-ink-2">{fmtPct(o.modelProb, 1)}</b> ({fmtAmerican(o.fairAmerican)} fair)
                    </span>
                    <span>
                      street <b className="text-ink-2">{fmtPct(o.marketProb, 1)}</b>
                    </span>
                    <span>
                      FD {fmtAmerican(o.americanOdds)} → EV{" "}
                      <b className={o.legEv > 0 ? "text-up" : "text-down"}>
                        {o.legEv > 0 ? "+" : ""}
                        {fmtPct(o.legEv, 0)}
                      </b>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            These are either our best bets or our worst model errors — the Teams tab tells you
            which (check the unit profile and division race behind the number). Outliers on
            sample-priced legs (no dot) mean nothing until you enter the real price. The market
            anchor in Find Parlays automatically tempers these when sizing.
          </p>
        </Card>
      </div>

      {/* Team table: model vs experts */}
      <Card className="overflow-x-auto p-5">
        <SectionTitle>Team by team — model vs ESPN FPI vs the betting street</SectionTitle>
        <table className="tnum mt-3 w-full min-w-[860px] font-mono text-xs">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-ink-3">
              <th className="py-1.5">Team</th>
              <th className="py-1.5 text-right">Our power</th>
              <th className="py-1.5 text-right">FPI</th>
              <th className="py-1.5 text-right">Δ pts</th>
              <th className="py-1.5 text-right">Our wins</th>
              <th className="py-1.5 text-right">FPI wins</th>
              <th className="py-1.5 text-right">Our SB%</th>
              <th className="py-1.5 text-right">Street SB%</th>
              <th className="py-1.5 text-right">Our playoffs</th>
              <th className="py-1.5 text-right">Street</th>
            </tr>
          </thead>
          <tbody>
            {data.teams.map((t) => {
              const dPow = t.fpi != null ? t.power - t.fpi : null;
              return (
                <tr key={t.id} className="border-t border-line/60 text-ink-2 transition-colors hover:bg-surface-2">
                  <td className="py-1.5 font-sans text-[13px] font-semibold text-ink">{t.name}</td>
                  <td className="py-1.5 text-right">{t.power > 0 ? "+" : ""}{t.power.toFixed(1)}</td>
                  <td className="py-1.5 text-right text-ink-3">{t.fpi != null ? `${t.fpi > 0 ? "+" : ""}${t.fpi.toFixed(1)}` : "—"}</td>
                  <td className={`py-1.5 text-right font-bold ${dPow == null ? "" : Math.abs(dPow) > 2.5 ? "text-warn" : "text-ink-3"}`}>
                    {dPow != null ? `${dPow > 0 ? "+" : ""}${dPow.toFixed(1)}` : "—"}
                  </td>
                  <td className="py-1.5 text-right">{t.meanWins.toFixed(1)}</td>
                  <td className="py-1.5 text-right text-ink-3">{t.fpiProjWins?.toFixed(1) ?? "—"}</td>
                  <td className="py-1.5 text-right">{fmtPct(t.pSb, 1)}</td>
                  <td className="py-1.5 text-right text-ink-3">{t.mktSb != null ? fmtPct(t.mktSb, 1) : "—"}</td>
                  <td className="py-1.5 text-right">{fmtPct(t.pPlayoffs, 0)}</td>
                  <td className="py-1.5 text-right text-ink-3">{t.mktPlayoffs != null ? fmtPct(t.mktPlayoffs, 0) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          Δ pts highlighted amber when we differ from FPI by more than a field goal — those teams
          deserve a look in the Teams tab before betting on (or against) our number.
        </p>
      </Card>
    </div>
  );
}

function ScatterPlot({ points }: { points: ScatterPoint[] }) {
  const S = 300; // plot size in px
  const pad = 6;
  const x = (v: number) => pad + v * (S - 2 * pad);
  const y = (v: number) => S - pad - v * (S - 2 * pad);
  return (
    <svg
      viewBox={`0 0 ${S} ${S}`}
      className="mt-3 w-full max-w-105 rounded-lg border border-line bg-bg"
      role="img"
      aria-label="Model probability vs market probability scatter plot"
    >
      {/* ±10pp agreement band */}
      <polygon
        points={`${x(0)},${y(0.1)} ${x(0.9)},${y(1)} ${x(1)},${y(1)} ${x(1)},${y(0.9)} ${x(0.1)},${y(0)} ${x(0)},${y(0)}`}
        fill="currentColor"
        className="text-ink-3"
        opacity={0.08}
      />
      {/* diagonal */}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="currentColor" className="text-line-2" strokeWidth={1} />
      {/* axis labels */}
      <text x={S / 2} y={S - 1} textAnchor="middle" className="fill-[--color-ink-3]" fontSize={8}>
        street probability →
      </text>
      <text x={7} y={S / 2} textAnchor="middle" transform={`rotate(-90 7 ${S / 2})`} className="fill-[--color-ink-3]" fontSize={8}>
        our probability →
      </text>
      {points.map((p, i) => (
        <circle
          key={i}
          cx={x(p.mkt)}
          cy={y(p.model)}
          r={p.source === "sample" ? 2 : 3.2}
          fill={MARKET_COLOR[p.market] ?? "var(--color-chart-blue)"}
          opacity={p.source === "sample" ? 0.35 : 0.95}
          stroke="var(--color-bg)"
          strokeWidth={0.6}
        >
          <title>
            {p.label}: model {(p.model * 100).toFixed(1)}% vs street {(p.mkt * 100).toFixed(1)}%
          </title>
        </circle>
      ))}
    </svg>
  );
}
