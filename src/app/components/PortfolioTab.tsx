"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtAmerican, fmtMoney, fmtPct } from "@/lib/format";
import type { Adjustment, CustomBoard, LegRow, ParlayLeg, PortfolioResponse, QbOverrides, SavedTicket } from "../clientTypes";

interface HedgeResp {
  pLive: number;
  totalReturn: number;
  fairValue: number;
  cashOut: { offer: number; haircut: number; haircutPct: number } | null;
  hedges: { legId: string; label: string; americanOdds: number; hedgeStake: number; guaranteedFloor: number; evAfterHedge: number }[];
}

interface ConstructResp {
  tickets: { legs: ParlayLeg[]; stake: number; combinedAmerican: number; jointProb: number; ev: number }[];
  summary: { staked: number; pProfit: number; expectedPnl: number; p5: number; p50: number; p95: number };
}

interface LeverageResp {
  week: number | null;
  hasTickets: boolean;
  games: { homeId: string; awayId: string; pHome: number; portfolioSwing: number | null; homePlayoffSwing: number; awayPlayoffSwing: number }[];
}
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
  const [hedgeOpen, setHedgeOpen] = useState<number | null>(null);
  const [hedgeData, setHedgeData] = useState<Record<number, HedgeResp>>({});
  const [cashOffer, setCashOffer] = useState("");
  const [conBudget, setConBudget] = useState(500);
  const [conObjective, setConObjective] = useState<"pProfit" | "median" | "upside">("pProfit");
  const [conResult, setConResult] = useState<ConstructResp | null>(null);
  const [conLoading, setConLoading] = useState(false);
  const [levData, setLevData] = useState<LeverageResp | null>(null);

  const stateBody = { adjustments, decidedGames, qbOverrides, customBoard };

  async function openHedge(i: number, t: PortfolioResponse["tickets"][number], offer?: string) {
    setHedgeOpen(i);
    const res = await fetch("/api/hedge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legIds: t.legIds,
        stake: t.stake,
        priceAmerican: t.combinedAmerican,
        cashOutOffer: offer ? Number(offer) : null,
        ...stateBody,
      }),
    });
    const d = await res.json();
    if (!d.error) setHedgeData((h) => ({ ...h, [i]: d }));
  }

  async function runConstructor() {
    setConLoading(true);
    try {
      const res = await fetch("/api/construct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget: conBudget, objective: conObjective, ...stateBody }),
      });
      const d = await res.json();
      if (!d.error) setConResult(d);
    } finally {
      setConLoading(false);
    }
  }

  useEffect(() => {
    fetch("/api/leverage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickets, ...stateBody }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setLevData(d);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, adjustments, decidedGames, qbOverrides, customBoard]);

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

      {/* Portfolio constructor */}
      <Card className="space-y-3 border-brand/25 p-4">
        <SectionTitle>🧮 Portfolio constructor — build the optimal ticket set</SectionTitle>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-3">$</span>
          <input
            type="number"
            value={conBudget}
            min={10}
            onChange={(e) => setConBudget(Number(e.target.value))}
            className="tnum w-24 rounded-lg border border-line bg-bg px-2.5 py-1.5 font-mono text-sm text-ink"
          />
          <select
            value={conObjective}
            onChange={(e) => setConObjective(e.target.value as typeof conObjective)}
            className="rounded-lg border border-line bg-bg px-2 py-1.5 text-xs text-ink"
          >
            <option value="pProfit">Maximize P(profit)</option>
            <option value="median">Maximize median outcome</option>
            <option value="upside">Maximize upside (p95)</option>
          </select>
          <button
            onClick={runConstructor}
            disabled={conLoading}
            className="rounded-lg bg-brand/90 px-4 py-1.5 text-sm font-bold text-white transition hover:bg-brand disabled:opacity-50"
          >
            {conLoading ? "Optimizing…" : "Construct"}
          </button>
        </div>
        {conResult && (
          <div className="space-y-1.5">
            <p className="tnum font-mono text-[11px] text-ink-2">
              {conResult.tickets.length} tickets · ${conResult.summary.staked} staked · P(profit){" "}
              {fmtPct(conResult.summary.pProfit, 0)} · EV ${conResult.summary.expectedPnl} · p5 $
              {conResult.summary.p5} / p95 ${conResult.summary.p95}
            </p>
            {conResult.tickets.map((t, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-bg px-3 py-1.5 text-xs">
                <span className="min-w-0 truncate">{t.legs.map((l) => l.label).join(" + ")}</span>
                <span className="tnum ml-2 shrink-0 font-mono text-ink-3">
                  ${t.stake} @ {fmtAmerican(t.combinedAmerican)} · {fmtPct(t.jointProb, 0)}
                </span>
              </div>
            ))}
            <button
              onClick={() => {
                setTickets([...tickets, ...conResult.tickets.map((t) => ({ legIds: t.legs.map((l) => l.id), stake: t.stake }))]);
                setConResult(null);
              }}
              className="rounded-lg bg-up px-3 py-1.5 text-xs font-bold text-[#03271c] hover:bg-up-dim"
            >
              Add all to portfolio
            </button>
          </div>
        )}
      </Card>

      {/* Leverage board */}
      {levData && levData.games.length > 0 && (
        <Card className="p-4">
          <SectionTitle>
            ⚡ Leverage board — week {levData.week}
            {levData.hasTickets ? " · impact on YOUR tickets" : " (add tickets to see $ impact)"}
          </SectionTitle>
          <div className="mt-2 space-y-1">
            {levData.games.slice(0, 8).map((g) => (
              <div key={`${g.homeId}${g.awayId}`} className="tnum flex items-center justify-between rounded-lg bg-bg px-3 py-1.5 font-mono text-xs">
                <span className="font-sans text-[13px]">
                  <b>{g.awayId}</b> @ <b>{g.homeId}</b>
                  <span className="ml-2 text-ink-3">{fmtPct(g.pHome, 0)} home</span>
                </span>
                <span className="flex gap-4 text-ink-3">
                  {g.portfolioSwing != null && (
                    <span className={Math.abs(g.portfolioSwing) > 1 ? "font-bold text-warn" : ""}>
                      swing ${Math.abs(g.portfolioSwing).toFixed(0)}
                    </span>
                  )}
                  <span title="Home team playoff-probability swing on this result">
                    {g.homeId} ±{(Math.abs(g.homePlayoffSwing) * 100).toFixed(0)}pp
                  </span>
                </span>
              </div>
            ))}
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
                    onClick={() => (hedgeOpen === i ? setHedgeOpen(null) : openHedge(i, t))}
                    className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 hover:border-brand/50 hover:text-brand"
                  >
                    {hedgeOpen === i ? "Close" : "Hedge"}
                  </button>
                  <button
                    onClick={() => setTickets(tickets.filter((_, j) => j !== i))}
                    className="text-ink-3 transition-colors hover:text-down"
                    title="Remove ticket"
                  >
                    ✕
                  </button>
                </div>
                {hedgeOpen === i && (
                  <div className="w-full border-t border-line pt-3">
                    {!hedgeData[i] ? (
                      <p className="tnum font-mono text-xs text-ink-3">Computing branches…</p>
                    ) : (
                      <div className="space-y-2 text-xs">
                        <p className="tnum font-mono text-ink-2">
                          Live {fmtPct(hedgeData[i].pLive, 1)} · pays ${hedgeData[i].totalReturn.toLocaleString()} ·{" "}
                          <b className="text-up">fair value ${hedgeData[i].fairValue.toLocaleString()}</b>
                        </p>
                        <span className="flex items-center gap-2">
                          <span className="text-ink-3">Book's cash-out offer? $</span>
                          <input
                            value={cashOffer}
                            onChange={(e) => setCashOffer(e.target.value)}
                            onBlur={() => cashOffer && openHedge(i, t, cashOffer)}
                            className="tnum w-24 rounded-lg border border-line bg-bg px-2 py-1 font-mono text-xs text-ink"
                            inputMode="numeric"
                          />
                          {hedgeData[i].cashOut && (
                            <span className={hedgeData[i].cashOut!.haircut > 0 ? "font-bold text-down" : "font-bold text-up"}>
                              {hedgeData[i].cashOut!.haircut > 0
                                ? `ripoff: $${hedgeData[i].cashOut!.haircut.toLocaleString()} below fair (${fmtPct(hedgeData[i].cashOut!.haircutPct, 0)})`
                                : "above fair — take it"}
                            </span>
                          )}
                        </span>
                        {hedgeData[i].hedges.length === 0 ? (
                          <p className="text-ink-3">
                            No profitable lock exists yet — the ticket's live probability is too
                            low to hedge into a guaranteed floor. Menus appear as legs cash.
                          </p>
                        ) : (
                          hedgeData[i].hedges.slice(0, 4).map((h) => (
                            <div key={h.legId} className="tnum flex items-center justify-between rounded-lg bg-bg px-3 py-1.5 font-mono">
                              <span className="font-sans">{h.label} ({fmtAmerican(h.americanOdds)})</span>
                              <span className="text-ink-3">
                                bet ${h.hedgeStake.toLocaleString()} → floor{" "}
                                <b className={h.guaranteedFloor >= 0 ? "text-up" : "text-down"}>
                                  ${h.guaranteedFloor.toLocaleString()}
                                </b>{" "}
                                · EV ${h.evAfterHedge.toLocaleString()}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
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
