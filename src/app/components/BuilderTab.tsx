"use client";

import { useState } from "react";
import { fmtAmerican, fmtPct } from "@/lib/format";
import {
  MARKETS,
  type Adjustment,
  type CustomBoard,
  type MarketType,
  type ParlayLeg,
  type QbOverrides,
  type SavedTicket,
  type TeamMeta,
} from "../clientTypes";
import type { DecidedGame } from "./FindTab";
import { Card, Chip, EmptyState, SectionTitle, Stat } from "./ui";

interface ConstructResp {
  tickets: { legs: ParlayLeg[]; stake: number; combinedAmerican: number; jointProb: number; ev: number }[];
  summary: { staked: number; pProfit: number; expectedPnl: number; p5: number; p50: number; p95: number };
}

export function BuilderTab({
  teams,
  adjustments,
  decidedGames,
  qbOverrides,
  customBoard,
  onAddTickets,
}: {
  teams: TeamMeta[];
  adjustments: Adjustment[];
  decidedGames: DecidedGame[];
  qbOverrides: QbOverrides;
  customBoard: CustomBoard;
  onAddTickets: (t: SavedTicket[]) => void;
}) {
  const [budget, setBudget] = useState(500);
  const [objective, setObjective] = useState<"pProfit" | "median" | "upside">("pProfit");
  const [exMarkets, setExMarkets] = useState<Set<MarketType>>(new Set());
  const [exTeams, setExTeams] = useState<Set<string>>(new Set());
  const [exLegs, setExLegs] = useState<{ id: string; label: string }[]>([]);
  const [result, setResult] = useState<ConstructResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);

  async function run(extraExcludes: { id: string; label: string }[] = exLegs) {
    setLoading(true);
    setAdded(false);
    try {
      const res = await fetch("/api/construct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget,
          objective,
          excludeMarkets: [...exMarkets],
          excludeTeams: [...exTeams],
          excludeLegIds: extraExcludes.map((e) => e.id),
          adjustments,
          decidedGames,
          qbOverrides,
          customBoard,
        }),
      });
      const d = await res.json();
      if (!d.error) setResult(d);
    } finally {
      setLoading(false);
    }
  }

  // Veto one leg from a proposed ticket and rebuild around your view.
  function vetoLeg(leg: ParlayLeg) {
    const next = [...exLegs, { id: leg.id, label: leg.label }];
    setExLegs(next);
    run(next);
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
      <Card className="space-y-4 p-4 lg:sticky lg:top-28 lg:self-start">
        <SectionTitle>🧮 Portfolio builder — steer it to your view</SectionTitle>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-3">Budget $</span>
          <input
            type="number"
            value={budget}
            min={10}
            onChange={(e) => setBudget(Number(e.target.value))}
            className="tnum w-24 rounded-lg border border-line bg-bg px-2.5 py-1.5 font-mono text-sm text-ink"
          />
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {(
            [
              ["pProfit", "Maximize P(profitable season)", "safest set that still pays"],
              ["median", "Maximize median outcome", "best typical season"],
              ["upside", "Maximize upside (p95)", "lottery book with structure"],
            ] as const
          ).map(([k, label, hint]) => (
            <button
              key={k}
              onClick={() => setObjective(k)}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                objective === k ? "border-up-dim/60 bg-up/10 text-up" : "border-line text-ink-2 hover:border-line-2"
              }`}
            >
              <div className="font-bold">{label}</div>
              <div className="text-[10px] opacity-70">{hint}</div>
            </button>
          ))}
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Exclude markets</p>
          <div className="flex flex-wrap gap-1.5">
            {MARKETS.map((m) => (
              <Chip
                key={m.key}
                active={exMarkets.has(m.key)}
                onClick={() =>
                  setExMarkets((prev) => {
                    const n = new Set(prev);
                    if (n.has(m.key)) n.delete(m.key);
                    else n.add(m.key);
                    return n;
                  })
                }
              >
                {m.label}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Exclude teams {exTeams.size > 0 && `(${exTeams.size})`}
          </p>
          <div className="grid grid-cols-8 gap-1">
            {teams.map((t) => (
              <button
                key={t.id}
                onClick={() =>
                  setExTeams((prev) => {
                    const n = new Set(prev);
                    if (n.has(t.id)) n.delete(t.id);
                    else n.add(t.id);
                    return n;
                  })
                }
                className={`rounded-md border px-0.5 py-1 font-mono text-[9px] font-bold transition-colors ${
                  exTeams.has(t.id)
                    ? "border-down/50 bg-down/10 text-down line-through"
                    : "border-line text-ink-3 hover:border-line-2"
                }`}
              >
                {t.id}
              </button>
            ))}
          </div>
        </div>
        {exLegs.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Vetoed bets</p>
            <div className="space-y-1">
              {exLegs.map((e) => (
                <div key={e.id} className="flex items-center justify-between rounded-lg bg-bg px-2.5 py-1 text-xs">
                  <span className="truncate">{e.label}</span>
                  <button
                    onClick={() => {
                      const next = exLegs.filter((x) => x.id !== e.id);
                      setExLegs(next);
                      run(next);
                    }}
                    className="ml-2 text-ink-3 hover:text-up"
                    title="Un-veto"
                  >
                    ↺
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={() => run()}
          disabled={loading}
          className="w-full rounded-lg bg-brand/90 py-2.5 text-sm font-bold text-white transition hover:bg-brand disabled:opacity-50"
        >
          {loading ? "Optimizing across 20,000 seasons…" : "Construct portfolio"}
        </button>
      </Card>

      <div className="space-y-3">
        {!result && !loading && (
          <EmptyState>
            Set a budget and an objective, exclude anything you don't believe in, and the builder
            assembles the best ticket SET — evaluated jointly, so diversification is real. Veto any
            leg it proposes (✕) and it rebuilds around your view.
          </EmptyState>
        )}
        {result && (
          <>
            <Card className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
              <Stat label="Staked" value={`$${result.summary.staked}`} size="lg" />
              <Stat label="P(profit)" value={fmtPct(result.summary.pProfit, 0)} tone="good" size="lg" glow />
              <Stat
                label="Expected P&L"
                value={`${result.summary.expectedPnl >= 0 ? "+" : ""}$${result.summary.expectedPnl}`}
                tone={result.summary.expectedPnl >= 0 ? "good" : "bad"}
                size="lg"
              />
              <Stat label="Bad season (p5)" value={`$${result.summary.p5}`} tone="warn" size="lg" />
              <Stat label="Great season (p95)" value={`$${result.summary.p95}`} tone="good" size="lg" />
            </Card>
            {result.tickets.map((t, i) => (
              <Card key={i} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="tnum font-mono text-sm font-bold">
                    ${t.stake} @ {fmtAmerican(t.combinedAmerican)}
                  </span>
                  <span className="tnum font-mono text-xs text-ink-3">
                    {fmtPct(t.jointProb, 0)} to hit · EV {t.ev >= 0 ? "+" : ""}
                    {fmtPct(t.ev, 0)}
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  {t.legs.map((l) => (
                    <div key={l.id} className="flex items-center justify-between rounded-lg bg-bg px-3 py-1.5 text-sm">
                      <span>{l.label}</span>
                      <span className="flex items-center gap-3">
                        <span className="tnum font-mono text-xs text-ink-3">{fmtAmerican(l.americanOdds)}</span>
                        <button
                          onClick={() => vetoLeg(l)}
                          className="text-ink-3 hover:text-down"
                          title="I don't believe in this bet — rebuild without it"
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
            {result.tickets.length > 0 && (
              <button
                onClick={() => {
                  onAddTickets(result.tickets.map((t) => ({ legIds: t.legs.map((l) => l.id), stake: t.stake })));
                  setAdded(true);
                }}
                className="rounded-lg bg-up px-4 py-2 text-sm font-bold text-[#03271c] transition hover:bg-up-dim"
              >
                {added ? "Added to portfolio ✓" : "Add all to portfolio"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
