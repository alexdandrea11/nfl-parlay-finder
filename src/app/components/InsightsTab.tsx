"use client";

import { useEffect, useState } from "react";
import { fmtPct } from "@/lib/format";
import type { Adjustment, CustomBoard, QbOverrides } from "../clientTypes";
import type { DecidedGame } from "./FindTab";
import { Card, EmptyState, SectionTitle, Skeleton } from "./ui";

interface SeedRow {
  id: string;
  name: string;
  conference: string;
  pPlayoffs: number;
  seeds: number[];
}

interface CorrData {
  legs: { id: string; label: string; market: string; ev: number; source: string }[];
  matrix: number[][];
}

interface HistoryPoint {
  ts: number;
  teams: Record<string, { w: number; po: number; dv: number; sb: number }>;
}

interface InsightsData {
  seeding: SeedRow[];
  correlations: CorrData;
  history: HistoryPoint[];
  sims: number;
}

export function InsightsTab({
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
  const [data, setData] = useState<InsightsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conf, setConf] = useState<"AFC" | "NFC">("AFC");
  const [metric, setMetric] = useState<"po" | "dv" | "sb" | "w">("po");
  const [digest, setDigest] = useState<{ at: number; lines: string[] } | null>(null);

  useEffect(() => {
    fetch("/api/digest")
      .then((r) => r.json())
      .then((d) => d?.at && setDigest(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adjustments, decidedGames, qbOverrides, customBoard }),
    })
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError("Failed to load insights"));
  }, [adjustments, decidedGames, qbOverrides, customBoard]);

  if (error) return <EmptyState>{error}</EmptyState>;
  if (!data)
    return (
      <div className="space-y-3">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    );

  const confRows = data.seeding.filter((r) => r.conference === conf && r.pPlayoffs > 0.005);

  return (
    <div className="space-y-4">
      {digest && (
        <Card className="p-4">
          <SectionTitle>
            📰 Daily brief · {new Date(digest.at).toLocaleDateString()}
          </SectionTitle>
          <ul className="mt-2 space-y-0.5 text-[13px] text-ink-2">
            {digest.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-ink-3">
            Written by the daily cron. To get this on your phone: install the free ntfy app,
            subscribe to a private topic name, and set NTFY_TOPIC in Vercel env — pushes start the
            next morning.
          </p>
        </Card>
      )}
      {/* Seeding matrix */}
      <Card className="overflow-x-auto p-5">
        <div className="flex items-center justify-between">
          <SectionTitle>Playoff seeding matrix · P(lands seed k)</SectionTitle>
          <div className="flex gap-1">
            {(["AFC", "NFC"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setConf(c)}
                className={`rounded-lg border px-3 py-1 text-xs font-bold transition-colors ${
                  conf === c ? "border-brand/60 bg-brand/10 text-brand" : "border-line text-ink-3"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <table className="tnum mt-3 w-full min-w-[620px] font-mono text-xs">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-ink-3">
              <th className="py-1.5">Team</th>
              {[1, 2, 3, 4, 5, 6, 7].map((s) => (
                <th key={s} className="px-1 py-1.5 text-center">#{s}{s === 1 ? " (bye)" : ""}</th>
              ))}
              <th className="py-1.5 text-right">Any</th>
            </tr>
          </thead>
          <tbody>
            {confRows.map((r) => (
              <tr key={r.id} className="border-t border-line/60">
                <td className="py-1 font-sans text-[13px] font-semibold text-ink">{r.name}</td>
                {r.seeds.map((p, k) => (
                  <td key={k} className="px-1 py-1 text-center">
                    <div
                      className="mx-auto grid h-7 w-full min-w-11 place-items-center rounded"
                      style={{
                        background: `color-mix(in oklab, var(--color-chart-blue) ${Math.min(95, p * 260)}%, var(--color-bg))`,
                        color: p > 0.18 ? "#fff" : "var(--color-ink-2)",
                      }}
                      title={`${r.name} → seed ${k + 1}: ${fmtPct(p, 1)}`}
                    >
                      {p >= 0.005 ? fmtPct(p, 0) : "·"}
                    </div>
                  </td>
                ))}
                <td className="py-1 text-right text-ink-2">{fmtPct(r.pPlayoffs, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          Seeds 1–4 are division winners (seed 1 gets the only bye); 5–7 are wild cards. Teams
          under 0.5% playoff probability are hidden.
        </p>
      </Card>

      {/* Correlation heatmap */}
      <Card className="overflow-x-auto p-5">
        <SectionTitle>Leg correlation heatmap — parlay ingredients</SectionTitle>
        <CorrGrid corr={data.correlations} />
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          <span className="font-semibold text-up">Green</span> pairs win together more often than
          independence implies — books usually price parlays as independent, so strong green pairs
          are where parlay value hides. <span className="font-semibold text-down">Red</span> pairs
          fight each other. Showing the {data.correlations.legs.length} highest-|EV| legs; hover
          any cell for the pair.
        </p>
      </Card>

      {/* Probability timeline */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>Model probability timeline</SectionTitle>
          <div className="flex gap-1">
            {(
              [
                ["po", "Playoffs"],
                ["dv", "Division"],
                ["sb", "Super Bowl"],
                ["w", "Proj. wins"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setMetric(k)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                  metric === k ? "border-brand/60 bg-brand/10 text-brand" : "border-line text-ink-3"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {data.history.length < 2 ? (
          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
            Capturing one model snapshot per day starting now
            {data.history.length === 1 && " (first point recorded)"} — after a few days this
            becomes a line chart of every team's odds drifting as games are played, news breaks,
            and the in-season data blends in. Check back.
          </p>
        ) : (
          <Timeline history={data.history} metric={metric} />
        )}
      </Card>
    </div>
  );
}

function CorrGrid({ corr }: { corr: CorrData }) {
  const n = corr.legs.length;
  const short = (label: string) =>
    label.replace(" win Super Bowl", " SB").replace(" make playoffs", " PO").replace(" win conference", " Conf").replace(" wins", "w");
  return (
    <div className="mt-3 inline-block">
      <div
        className="grid gap-px"
        style={{ gridTemplateColumns: `120px repeat(${n}, 22px)` }}
      >
        <div />
        {corr.legs.map((l, j) => (
          <div key={j} className="flex h-24 items-end justify-center" title={l.label}>
            <span
              className="whitespace-nowrap font-mono text-[8px] text-ink-3"
              style={{ transform: "rotate(-60deg)", transformOrigin: "bottom left" }}
            >
              {short(l.label)}
            </span>
          </div>
        ))}
        {corr.legs.map((rowLeg, i) => (
          <FragmentRow key={i} i={i} corr={corr} short={short} />
        ))}
      </div>
    </div>
  );
}

function FragmentRow({
  i,
  corr,
  short,
}: {
  i: number;
  corr: CorrData;
  short: (s: string) => string;
}) {
  return (
    <>
      <div className="truncate pr-2 text-right font-mono text-[9px] leading-[22px] text-ink-2" title={corr.legs[i].label}>
        {short(corr.legs[i].label)}
      </div>
      {corr.matrix[i].map((v, j) => {
        const mag = Math.min(1, Math.abs(v) * 2.2);
        const color =
          i === j
            ? "var(--color-surface-3)"
            : v > 0
              ? `color-mix(in oklab, var(--color-chart-green) ${mag * 100}%, var(--color-bg))`
              : `color-mix(in oklab, var(--color-chart-red) ${mag * 100}%, var(--color-bg))`;
        return (
          <div
            key={j}
            className="h-[22px] w-[22px] rounded-[3px]"
            style={{ background: color }}
            title={
              i === j
                ? corr.legs[i].label
                : `${corr.legs[i].label} × ${corr.legs[j].label}: r=${v.toFixed(2)}`
            }
          />
        );
      })}
    </>
  );
}

const LINE_COLORS = ["#3b82f6", "#0d9f6d", "#c17a06", "#ef4444", "#8b5cf6", "#0ea5e9"];

function Timeline({ history, metric }: { history: HistoryPoint[]; metric: "po" | "dv" | "sb" | "w" }) {
  // Top 6 teams by latest value.
  const latest = history[history.length - 1];
  const teams = Object.entries(latest.teams)
    .sort(([, a], [, b]) => b[metric] - a[metric])
    .slice(0, 6)
    .map(([id]) => id);
  const W = 720;
  const H = 220;
  const pad = 30;
  const t0 = history[0].ts;
  const t1 = latest.ts;
  // Zoom the y-axis to the data range so drift is visible (a 0-based axis
  // flattens everything preseason).
  const vals = history.flatMap((h) => teams.map((id) => h.teams[id]?.[metric] ?? 0));
  const vMax = Math.max(...vals);
  const vMin = Math.min(...vals);
  const span = Math.max(vMax - vMin, metric === "w" ? 1 : 0.04);
  const yTop = vMax + span * 0.15;
  const yBot = Math.max(0, vMin - span * 0.15);
  const x = (ts: number) => pad + ((ts - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - yBot) / (yTop - yBot)) * (H - 2 * pad);
  // De-overlap the end labels: sort by position, enforce 11px separation.
  const labelYs = new Map<string, number>();
  teams
    .map((id) => ({ id, ly: y(latest.teams[id][metric]) }))
    .sort((a, b) => a.ly - b.ly)
    .forEach((e, i, arr) => {
      const minY = i === 0 ? e.ly : Math.max(e.ly, (labelYs.get(arr[i - 1].id) ?? 0) + 11);
      labelYs.set(e.id, minY);
    });
  return (
    <div className="mt-3 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[560px] rounded-lg border border-line bg-bg" role="img">
        {teams.map((id, ti) => {
          const pts = history
            .filter((h) => h.teams[id])
            .map((h) => `${x(h.ts)},${y(h.teams[id][metric])}`)
            .join(" ");
          return (
            <g key={id}>
              <polyline points={pts} fill="none" stroke={LINE_COLORS[ti]} strokeWidth={2} />
              <text
                x={W - pad + 4}
                y={(labelYs.get(id) ?? y(latest.teams[id][metric])) + 3}
                fontSize={9}
                fill={LINE_COLORS[ti]}
                className="font-mono"
              >
                {id} {metric === "w" ? latest.teams[id][metric].toFixed(1) : `${(latest.teams[id][metric] * 100).toFixed(0)}%`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
