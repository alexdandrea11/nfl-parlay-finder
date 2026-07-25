"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtAmerican, fmtMoney, fmtPct } from "@/lib/format";
import type { Adjustment, CustomBoard, LegRow, PortfolioResponse, QbOverrides, SavedTicket } from "../clientTypes";
import type { DecidedGame } from "./FindTab";
import { Card, EmptyState, SectionTitle, Skeleton, Stat, TextInput } from "./ui";

export function PortfolioTab({
  tickets,
  setTickets,
  adjustments,
  decidedGames,
  qbOverrides,
  customBoard,
}: {
  tickets: SavedTicket[];
  setTickets: (t: SavedTicket[]) => void;
  adjustments: Adjustment[];
  decidedGames: DecidedGame[];
  qbOverrides: QbOverrides;
  customBoard: CustomBoard;
}) {
  const [result, setResult] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legs, setLegs] = useState<LegRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [draftStake, setDraftStake] = useState(25);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch("/api/legs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adjustments, decidedGames, qbOverrides, customBoard }),
    })
      .then((r) => r.json())
      .then((d) => setLegs(d.legs ?? []))
      .catch(() => {});
  }, [adjustments, decidedGames, qbOverrides, customBoard]);

  async function evaluate() {
    if (tickets.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickets,
          customBoard,
          engineOptions: { adjustments, decidedGames, qbOverrides },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Evaluation failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tickets.length > 0) evaluate();
    else setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, adjustments, decidedGames, qbOverrides, customBoard]);

  function addDraftTicket() {
    if (draft.length === 0 || draftStake <= 0) return;
    setTickets([...tickets, { legIds: draft, stake: draftStake }]);
    setDraft([]);
    setPickerOpen(false);
  }

  const pickerLegs = useMemo(() => {
    const q = filter.toLowerCase();
    return legs
      .filter((l) => !q || l.label.toLowerCase().includes(q))
      .sort((a, b) => b.legEv - a.legEv)
      .slice(0, 40);
  }, [legs, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Your tickets — evaluated as one book</SectionTitle>
        <button
          onClick={() => setPickerOpen((o) => !o)}
          className="rounded-lg border border-line px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
        >
          {pickerOpen ? "Close builder" : "+ Build a ticket"}
        </button>
      </div>

      {pickerOpen && (
        <Card className="space-y-3 p-4">
          <TextInput
            placeholder="Search legs (e.g. Chiefs, playoffs, OVER)…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {pickerLegs.map((l) => {
              const sel = draft.includes(l.id);
              return (
                <button
                  key={l.id}
                  onClick={() => setDraft(sel ? draft.filter((id) => id !== l.id) : [...draft, l.id])}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    sel ? "border-up-dim/60 bg-up/10" : "border-transparent bg-bg hover:border-line"
                  }`}
                >
                  <span>{l.label}</span>
                  <span className="tnum flex gap-3 font-mono text-xs">
                    <span className="text-ink-3">{fmtPct(l.modelProb, 0)}</span>
                    <span className="font-semibold text-ink">{fmtAmerican(l.americanOdds)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-xs text-ink-2">
            <span>{draft.length} legs · stake $</span>
            <input
              type="number"
              value={draftStake}
              min={1}
              onChange={(e) => setDraftStake(Number(e.target.value))}
              className="tnum w-24 rounded-lg border border-line bg-bg px-2.5 py-1.5 font-mono text-sm text-ink"
            />
            <button
              onClick={addDraftTicket}
              disabled={draft.length === 0 || draftStake <= 0}
              className="rounded-lg bg-up px-4 py-1.5 text-sm font-bold text-[#03271c] transition hover:bg-up-dim disabled:opacity-40"
            >
              Add ticket
            </button>
          </div>
        </Card>
      )}

      {error && (
        <div className="rounded-lg border border-down/40 bg-down/10 p-3 text-sm text-down">{error}</div>
      )}

      {tickets.length === 0 && (
        <EmptyState>
          No tickets yet. Add parlays from the <b className="text-ink">Find</b> tab (the "+
          Portfolio" button) or build one here. The portfolio view runs all your tickets through
          the same simulated seasons, so it sees when they secretly ride the same outcome.
        </EmptyState>
      )}

      {tickets.length > 0 && !result && loading && (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-32" />
        </div>
      )}

      {result && (
        <>
          <Card className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
            <Stat label="Total staked" value={fmtMoney(result.totalStake)} size="xl" />
            <Stat
              label="Expected P&L"
              value={`${result.expectedPnl >= 0 ? "+" : ""}${fmtMoney(result.expectedPnl)}`}
              tone={result.expectedPnl >= 0 ? "good" : "bad"}
              size="xl"
              glow
            />
            <Stat label="P(any profit)" value={fmtPct(result.probProfit)} size="xl" />
            <Stat label="P(lose it all)" value={fmtPct(result.probTotalLoss)} tone="warn" size="xl" />
            <Stat label="If everything hits" value={`+${fmtMoney(result.best)}`} tone="good" size="xl" />
          </Card>

          <Card className="p-5">
            <SectionTitle>
              Outcome distribution · {result.sims.toLocaleString()} simulated seasons
            </SectionTitle>
            <div className="mt-4">
              <PnlBar percentiles={result.percentiles} />
            </div>
          </Card>

          {result.exposure.length > 0 && (
            <Card className="p-5">
              <SectionTitle>Team exposure — how concentrated are you?</SectionTitle>
              <div className="mt-3 space-y-2">
                {result.exposure.map((e) => (
                  <div key={e.teamId} className="flex items-center gap-3 text-xs">
                    <span className="w-10 shrink-0 font-mono font-bold text-ink-2">{e.teamId}</span>
                    <div className="h-3.5 flex-1 overflow-hidden rounded bg-bg">
                      <div
                        className={`h-full rounded-r ${
                          e.pct > 0.5
                            ? "bg-chart-red"
                            : e.pct > 0.3
                              ? "bg-chart-amber"
                              : "bg-chart-blue"
                        }`}
                        style={{ width: `${Math.min(100, e.pct * 100)}%` }}
                      />
                    </div>
                    <span className="tnum w-28 shrink-0 text-right font-mono text-ink-3">
                      {fmtMoney(e.stake)} · {fmtPct(e.pct, 0)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="space-y-2">
            {result.tickets.map((t, i) => (
              <Card key={i} hover className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="text-sm leading-snug">
                    {t.valid ? (
                      t.legLabels.join("  +  ")
                    ) : (
                      <span className="text-down">Invalid ticket (unknown leg id)</span>
                    )}
                  </div>
                  <div className="tnum mt-1 font-mono text-[11px] text-ink-3">
                    {fmtMoney(t.stake)} @ {fmtAmerican(t.combinedAmerican)} → to win {fmtMoney(t.toWin)}
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  <Stat label="Win prob" value={fmtPct(t.jointProb)} />
                  <Stat
                    label="EV"
                    value={`${t.ev >= 0 ? "+" : ""}${fmtPct(t.ev, 1)}`}
                    tone={t.ev >= 0 ? "good" : "bad"}
                  />
                  <button
                    onClick={() => setTickets(tickets.filter((_, j) => j !== i))}
                    className="text-ink-3 transition-colors hover:text-down"
                    title="Remove ticket"
                  >
                    ✕
                  </button>
                </div>
              </Card>
            ))}
          </div>

          {loading && <p className="tnum font-mono text-xs text-ink-3">Re-evaluating…</p>}
        </>
      )}
    </div>
  );
}

function PnlBar({ percentiles: p }: { percentiles: PortfolioResponse["percentiles"] }) {
  const lo = Math.min(p.p5, 0);
  const hi = Math.max(p.p95, 0);
  const span = hi - lo || 1;
  const x = (v: number) => `${((v - lo) / span) * 100}%`;
  const marks: { v: number; label: string }[] = [
    { v: p.p5, label: "p5" },
    { v: p.p25, label: "p25" },
    { v: p.p50, label: "median" },
    { v: p.p75, label: "p75" },
    { v: p.p95, label: "p95" },
  ];
  return (
    <div>
      <div className="relative h-9">
        {/* zero line */}
        <div className="absolute top-0 h-full w-px bg-ink-3" style={{ left: x(0) }}>
          <span className="absolute -top-0.5 left-1.5 text-[9px] font-semibold uppercase tracking-wider text-ink-3">
            $0
          </span>
        </div>
        {/* p5–p95 band */}
        <div
          className="absolute top-3.5 h-3 rounded-full opacity-80"
          style={{
            left: x(p.p5),
            width: `calc(${x(p.p95)} - ${x(p.p5)})`,
            background:
              "linear-gradient(90deg, var(--color-chart-red), var(--color-chart-amber), var(--color-chart-green))",
          }}
        />
        {marks.map((m) => (
          <div
            key={m.label}
            className="absolute top-2.5 h-5 w-0.5 rounded bg-ink"
            style={{ left: x(m.v) }}
            title={`${m.label}: ${fmtMoney(m.v)}`}
          />
        ))}
      </div>
      <div className="tnum relative mt-1 h-9 font-mono text-[10px] text-ink-2">
        {marks.map((m, i) => (
          <div
            key={m.label}
            className="absolute -translate-x-1/2 text-center"
            style={{ left: x(m.v), top: i % 2 === 0 ? 0 : 16 }}
          >
            <div>{fmtMoney(m.v)}</div>
            <div className="text-ink-3">{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
