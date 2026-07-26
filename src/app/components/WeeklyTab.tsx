"use client";

import { useEffect, useState } from "react";
import { fmtAmerican, fmtPct } from "@/lib/format";
import type { Adjustment, QbOverrides } from "../clientTypes";
import type { DecidedGame } from "./FindTab";
import { Card, EmptyState, SectionTitle, Skeleton } from "./ui";

interface WeeklyData {
  weeks: number[];
  week: number | null;
  legs: { gameKey: string; label: string; kind: string; price: number; prob: number; ev: number }[];
  parlays: { legs: string[]; prob: number; american: number; ev: number }[];
  teasers: { n: number; payout: number; legs: string[]; prob: number; ev: number }[];
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Best parlays */}
        <Card className="p-5">
          <SectionTitle>Best cross-game parlays · week {data.week} · ranked by EV</SectionTitle>
          <div className="mt-3 space-y-1.5">
            {data.parlays.map((p, i) => (
              <div key={i} className={`rounded-lg border bg-bg p-3 ${i === 0 ? "border-up-dim/60" : "border-line"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] text-ink">
                    {i === 0 && "⭐ "}
                    {p.legs.join(" + ")}
                  </span>
                  <span className="tnum shrink-0 font-mono text-xs text-ink-3">
                    {fmtAmerican(p.american)} · {fmtPct(p.prob, 1)} ·{" "}
                    <b className={p.ev >= 0 ? "text-up" : "text-down"}>
                      EV {p.ev >= 0 ? "+" : ""}
                      {fmtPct(p.ev, 1)}
                    </b>
                  </span>
                </div>
              </div>
            ))}
            {data.parlays.length === 0 && <p className="text-sm text-ink-2">No +EV combos this week.</p>}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            One leg per game (independent legs, exact math), built from the model's best
            moneyline/spread edges at FanDuel prices. ⭐ = highest EV.
          </p>
        </Card>

        {/* Best teasers */}
        <Card className="p-5">
          <SectionTitle>Best 6-point teasers · week {data.week}</SectionTitle>
          <div className="mt-3 space-y-1.5">
            {data.teasers.map((t) => (
              <div key={t.n} className="rounded-lg border border-line bg-bg p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-warn">
                    {t.n}-team · pays {fmtAmerican(t.payout)}
                  </span>
                  <span className="tnum font-mono text-xs text-ink-3">
                    {fmtPct(t.prob, 1)} ·{" "}
                    <b className={t.ev >= 0 ? "text-up" : "text-down"}>
                      EV {t.ev >= 0 ? "+" : ""}
                      {fmtPct(t.ev, 1)}
                    </b>
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink">{t.legs.join(" · ")}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            Spreads moved {6} points in your favor (shown as posted → teased), legs picked by
            teased win probability. Payouts are typical FanDuel 6-point prices — verify the quote.
            Note: our margin model treats all points equally; real teaser value concentrates on
            crossing 3 and 7, so prefer legs whose tease crosses both.
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
                  {l.ev > 0 ? "+" : ""}
                  {fmtPct(l.ev, 1)}
                </b>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
