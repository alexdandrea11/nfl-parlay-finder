"use client";

import { useEffect, useState } from "react";
import { fmtAmerican, fmtMoney, fmtPct } from "@/lib/format";
import type { DiagnosticsResponse } from "../clientTypes";
import { Card, EmptyState, SectionTitle, Skeleton, Stat } from "./ui";

interface BetLeg {
  id: string;
  label: string;
  americanOdds: number;
  impliedProb: number;
  modelProb: number;
  outcome?: "won" | "lost" | "pending";
}

interface Bet {
  id: string;
  placedAt: number;
  legs: BetLeg[];
  stake: number;
  priceAmerican: number;
  jointProb: number;
  anchoredProb: number;
  status: "open" | "won" | "lost";
  clv?: Record<string, number>;
}

export function ModelTab() {
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [bets, setBets] = useState<Bet[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/diagnostics")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError("Failed to load diagnostics"));
    fetch("/api/bets")
      .then((r) => r.json())
      .then((d) => setBets(d.bets ?? []))
      .catch(() => setBets([]));
  }, []);

  async function deleteBet(id: string) {
    await fetch(`/api/bets?id=${id}`, { method: "DELETE" }).catch(() => {});
    setBets((b) => (b ?? []).filter((x) => x.id !== id));
  }

  if (error) return <EmptyState>{error}</EmptyState>;
  if (!data)
    return (
      <div className="space-y-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-56" />
      </div>
    );

  const cal = data.calibration;

  return (
    <div className="space-y-4">
      {/* Logged bets */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>My logged bets — the real track record</SectionTitle>
          {bets && bets.length > 0 && (
            <span className="tnum font-mono text-[11px] text-ink-3">
              {bets.filter((b) => b.status === "won").length}W ·{" "}
              {bets.filter((b) => b.status === "lost").length}L ·{" "}
              {bets.filter((b) => b.status === "open").length} open
            </span>
          )}
        </div>
        {!bets ? (
          <Skeleton className="mt-3 h-16" />
        ) : bets.length === 0 ? (
          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
            Nothing logged yet. When you place a real bet, hit{" "}
            <b className="text-ink">Log bet</b> on its parlay card — the model probability and
            price are recorded, results grade automatically as the season plays out, and the
            calibration chart below switches from synthetic data to your actual record.
          </p>
        ) : (
          <div className="mt-3 space-y-1.5">
            {bets.map((b) => {
              const clvVals = Object.values(b.clv ?? {});
              const avgClv = clvVals.length
                ? clvVals.reduce((a, v) => a + v, 0) / clvVals.length
                : null;
              return (
                <div key={b.id} className="rounded-lg bg-bg px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[13px]">
                      {b.legs.map((l) => l.label).join(" + ")}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                          b.status === "won"
                            ? "bg-up/15 text-up"
                            : b.status === "lost"
                              ? "bg-down/15 text-down"
                              : "bg-surface-3 text-ink-2"
                        }`}
                      >
                        {b.status.toUpperCase()}
                      </span>
                      <button onClick={() => deleteBet(b.id)} className="text-ink-3 hover:text-down" title="Remove">
                        ✕
                      </button>
                    </span>
                  </div>
                  <div className="tnum mt-1 flex flex-wrap gap-x-4 font-mono text-[11px] text-ink-3">
                    <span>{new Date(b.placedAt).toLocaleDateString()}</span>
                    <span>{fmtMoney(b.stake)} @ {fmtAmerican(b.priceAmerican)}</span>
                    <span>model {fmtPct(b.jointProb, 1)} · anchored {fmtPct(b.anchoredProb, 1)}</span>
                    {avgClv != null && (
                      <span
                        className={avgClv > 0 ? "text-up" : avgClv < 0 ? "text-down" : ""}
                        title="Closing-line value: how far real prices have moved toward (positive) or away from (negative) your bet since you placed it"
                      >
                        CLV {avgClv > 0 ? "+" : ""}{(avgClv * 100).toFixed(1)}pp
                      </span>
                    )}
                    {b.status === "open" && (
                      <span>
                        {b.legs.filter((l) => l.outcome === "won").length}/{b.legs.length} legs decided-won
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {/* Invariants */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <SectionTitle>Engine invariants — structural sanity checks</SectionTitle>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-extrabold tracking-wide ${
              data.invariantsPass ? "bg-up/15 text-up" : "bg-down/15 text-down"
            }`}
          >
            {data.invariantsPass ? "ALL PASS" : "FAILING"}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {data.invariants.map((c) => (
            <div key={c.name} className="flex items-center justify-between rounded-lg bg-bg px-3 py-2 text-xs">
              <span className={c.ok ? "text-ink-2" : "text-down"}>{c.name}</span>
              <span className="tnum font-mono text-ink-3">
                {c.actual.toFixed(2)} / {c.expected}
                <span className={`ml-1.5 ${c.ok ? "text-up" : "text-down"}`}>{c.ok ? "✓" : "✗"}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          Probabilities that must sum exactly (one champ, one division winner, seven playoff teams
          per conference). If any fail, the simulation itself is broken.
        </p>
      </Card>

      {/* Model vs market */}
      <Card className="p-5">
        <SectionTitle>Model vs market consensus</SectionTitle>
        <div className="mt-4 flex flex-wrap gap-8">
          <Stat
            label="RMSE (prob points)"
            value={`${(data.agreement.rmse * 100).toFixed(1)}pp`}
            tone={data.agreement.rmse < 0.05 ? "good" : "warn"}
            size="xl"
          />
          <Stat label="Bias (model − market)" value={`${(data.agreement.bias * 100).toFixed(2)}pp`} size="xl" />
        </div>
        <div className="mt-5 space-y-2">
          {data.agreement.byMarket.map((m) => (
            <div key={m.market} className="flex items-center gap-3 text-xs">
              <span className="w-24 shrink-0 font-medium text-ink-2">{m.market}</span>
              <div className="h-3.5 flex-1 overflow-hidden rounded bg-bg">
                <div
                  className={`h-full rounded-r ${
                    m.rmse < 0.03
                      ? "bg-chart-green"
                      : m.rmse < 0.08
                        ? "bg-chart-amber"
                        : "bg-chart-red"
                  }`}
                  style={{ width: `${Math.min(100, m.rmse * 800)}%` }}
                  title={`${m.market}: RMSE ${(m.rmse * 100).toFixed(1)}pp over ${m.count} legs`}
                />
              </div>
              <span className="tnum w-14 shrink-0 text-right font-mono text-ink-3">
                {(m.rmse * 100).toFixed(1)}pp
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          How far the power-rating model departs from the vig-removed betting market. Small gaps
          are where edge lives; systematically huge gaps mean the ratings are wrong, not the
          market. With live odds on, this is the first thing to check before trusting a pick.
        </p>
      </Card>

      {/* Calibration backtest */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>Calibration backtest — do X% bets hit X% of the time?</SectionTitle>
          {data.calibrationIsSynthetic && (
            <span className="rounded-full bg-warn/10 px-3 py-1 text-[10px] font-bold text-warn">
              SYNTHETIC DEMO DATA — replace with your real bet history
            </span>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-8">
          <Stat label="Sample size" value={`${cal.n}`} size="xl" />
          <Stat label="Brier score" value={cal.brier.toFixed(3)} tone={cal.brier < 0.2 ? "good" : "warn"} size="xl" />
          <Stat label="Hit rate" value={fmtPct(cal.hitRate)} size="xl" />
          <Stat label="Mean predicted" value={fmtPct(cal.meanPredicted)} tone="muted" size="xl" />
        </div>

        <div className="mt-6">
          <div className="flex items-end gap-3" style={{ height: 150 }}>
            {cal.bins.map((b) => (
              <div
                key={b.lo}
                className="group relative flex flex-1 items-end justify-center gap-0.5"
                title={`${fmtPct(b.lo, 0)}–${fmtPct(b.hi, 0)}: predicted ${fmtPct(b.predicted)}, actually hit ${fmtPct(b.empirical)} (n=${b.count})`}
              >
                {/* predicted */}
                <div className="relative w-2/5 max-w-9">
                  <div
                    className="w-full rounded-t bg-chart-blue transition-opacity group-hover:opacity-100"
                    style={{ height: `${b.predicted * 132}px`, opacity: 0.85 }}
                  />
                  <span className="tnum absolute -top-4 left-1/2 hidden -translate-x-1/2 font-mono text-[9px] text-ink-2 group-hover:block">
                    {fmtPct(b.predicted, 0)}
                  </span>
                </div>
                {/* actual */}
                <div className="relative w-2/5 max-w-9">
                  <div
                    className="w-full rounded-t bg-chart-green transition-opacity group-hover:opacity-100"
                    style={{ height: `${b.empirical * 132}px`, opacity: 0.85 }}
                  />
                  <span className="tnum absolute -top-4 left-1/2 hidden -translate-x-1/2 font-mono text-[9px] text-ink-2 group-hover:block">
                    {fmtPct(b.empirical, 0)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-3 border-t border-line pt-1.5 text-center">
            {cal.bins.map((b) => (
              <div key={b.lo} className="tnum flex-1 font-mono text-[10px] text-ink-3">
                {fmtPct(b.lo, 0)}–{fmtPct(b.hi, 0)}
                <div className="text-ink-3/60">n={b.count}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-5 text-[11px] text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-chart-blue" /> predicted
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-chart-green" /> actually hit
            </span>
          </div>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
          Perfect calibration = the pairs match in every bucket. Brier 0.25 is a coin flip; lower
          is better. To make this real, log each futures bet's model probability when you place it
          and whether it hit, then load them in{" "}
          <code className="rounded bg-bg px-1 py-0.5 font-mono text-ink-2">src/lib/data/history.ts</code>.
          Until then this chart shows synthetic reference data and proves nothing about the model.
        </p>
      </Card>
    </div>
  );
}
