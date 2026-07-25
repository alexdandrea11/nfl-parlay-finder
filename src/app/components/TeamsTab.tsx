"use client";

import { useEffect, useState } from "react";
import { fmtPct } from "@/lib/format";
import type { Adjustment, QbInfo, QbOverrides, TeamMeta } from "../clientTypes";
import type { DecidedGame } from "./FindTab";
import { Card, EmptyState, SectionTitle, Skeleton, Stat } from "./ui";

interface WinDistRow {
  wins: number;
  p: number;
  pPlayoffsGiven: number | null;
  pDivisionGiven: number | null;
}

interface Rival {
  teamId: string;
  name: string;
  meanWins: number;
  pPlayoffs: number;
  pDivision: number;
  power: number;
}

interface H2hEntry {
  oppId: string;
  wins: number;
  losses: number;
  games: { season: number; week: number; home: string; away: string; homeScore: number; awayScore: number }[];
}

interface TeamDetail {
  teamId: string;
  name: string;
  conference: string;
  division: string;
  sims: number;
  meanWins: number;
  pPlayoffs: number;
  pDivision: number;
  pConference: number;
  pSuperbowl: number;
  power: number;
  winDist: WinDistRow[];
  rivals: Rival[];
  units: { passOff: number; rushOff: number; passDef: number; rushDef: number; league: { passOff: number; rushOff: number; passDef: number; rushDef: number } };
  h2h: H2hEntry[];
}

export function TeamsTab({
  teams,
  adjustments,
  decidedGames,
  qbs,
  qbStarters,
  qbOverrides,
  setQbOverrides,
}: {
  teams: TeamMeta[];
  adjustments: Adjustment[];
  decidedGames: DecidedGame[];
  qbs: QbInfo[];
  qbStarters: Record<string, string>;
  qbOverrides: QbOverrides;
  setQbOverrides: (q: QbOverrides) => void;
}) {
  const [teamId, setTeamId] = useState("BUF");
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId, adjustments, decidedGames, qbOverrides }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setDetail(d);
      })
      .catch(() => setError("Failed to load team detail"))
      .finally(() => setLoading(false));
  }, [teamId, adjustments, decidedGames, qbOverrides]);

  const starterId = qbStarters[teamId];
  const starter = qbs.find((q) => q.id === starterId);
  const overrideId = qbOverrides[teamId];

  function setQb(value: string) {
    const next = { ...qbOverrides };
    if (!value || value === starterId) delete next[teamId];
    else next[teamId] = value;
    setQbOverrides(next);
  }

  return (
    <div className="space-y-4">
      {/* Team picker */}
      <Card className="p-3">
        <div className="grid grid-cols-8 gap-1 sm:grid-cols-16">
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => setTeamId(t.id)}
              className={`rounded-md border px-1 py-1.5 font-mono text-[10px] font-bold transition-colors ${
                teamId === t.id
                  ? "border-up-dim/60 bg-up/10 text-up"
                  : "border-line text-ink-3 hover:border-line-2 hover:text-ink-2"
              }`}
              title={`${t.name} · ${t.rating > 0 ? "+" : ""}${t.rating} pts vs avg`}
            >
              {t.id}
            </button>
          ))}
        </div>
      </Card>

      {error && <div className="rounded-lg border border-down/40 bg-down/10 p-3 text-sm text-down">{error}</div>}
      {loading && !detail && (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      )}

      {detail && (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {/* Headline */}
          <Card className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
            <div>
              <div className="text-xl font-extrabold tracking-tight">{detail.name}</div>
              <div className="text-xs text-ink-3">
                {detail.conference} {detail.division} ·{" "}
                <span className="tnum font-mono">
                  {detail.power > 0 ? "+" : ""}
                  {detail.power} pts vs avg
                </span>
              </div>
            </div>
            <Stat label="Projected wins" value={detail.meanWins.toFixed(1)} size="xl" />
            <Stat label="Make playoffs" value={fmtPct(detail.pPlayoffs)} tone="good" size="xl" glow />
            <Stat label="Win division" value={fmtPct(detail.pDivision)} size="xl" />
            <Stat label="Win conference" value={fmtPct(detail.pConference)} size="xl" />
            <Stat label="Win Super Bowl" value={fmtPct(detail.pSuperbowl)} size="xl" />
          </Card>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* Win distribution */}
            <Card className="p-5">
              <SectionTitle>Projected win distribution · {detail.sims.toLocaleString()} seasons</SectionTitle>
              <WinDistChart dist={detail.winDist} />
              <SectionTitle>Playoff probability if they win exactly k games</SectionTitle>
              <CondChart
                dist={detail.winDist}
                value={(d) => d.pPlayoffsGiven}
                colorClass="bg-chart-green"
                outcome="make playoffs"
              />
              <SectionTitle>Division win probability if they win exactly k games</SectionTitle>
              <CondChart
                dist={detail.winDist}
                value={(d) => d.pDivisionGiven}
                colorClass="bg-chart-amber"
                outcome="win the division"
              />
              <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
                The conditional charts are the "how many wins do they need" answer — for a
                wild-card spot vs the division crown. Both already account for this division and
                the rest of the conference, because they're read from the same simulated seasons.
                The division bar sits lower at every win count: rivals can match a win total, but
                only one team takes the crown.
              </p>
            </Card>

            <div className="space-y-4">
              {/* Quarterback */}
              <Card className="p-5">
                <SectionTitle>Quarterback</SectionTitle>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <select
                    value={overrideId ?? starterId ?? ""}
                    onChange={(e) => setQb(e.target.value)}
                    className="min-w-56 rounded-lg border border-line bg-bg px-2.5 py-2 text-sm text-ink transition-colors hover:border-line-2"
                  >
                    {starter && (
                      <option value={starter.id}>
                        {starter.name} (projected starter · {starter.rating.toFixed(3)})
                      </option>
                    )}
                    <option value="replacement">Replacement-level backup</option>
                    {qbs
                      .filter((q) => q.id !== starterId)
                      .map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.name} ({q.team} · {q.rating.toFixed(3)})
                        </option>
                      ))}
                  </select>
                  {overrideId && (
                    <button
                      onClick={() => setQb("")}
                      className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-1.5 text-xs font-semibold text-warn transition-colors hover:border-warn/70"
                    >
                      QB override active — reset
                    </button>
                  )}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
                  Ratings are passing EPA per dropback (2023–25, volume-shrunk). Swapping the
                  starter shifts this team's passing offense by 75% of the QB gap — receivers, OL,
                  and scheme carry the rest. The swap flows through every simulation, market, and
                  the portfolio.
                </p>
              </Card>

              {/* Division race */}
              <Card className="p-5">
                <SectionTitle>Division race — {detail.conference} {detail.division}</SectionTitle>
                <table className="tnum mt-3 w-full font-mono text-xs">
                  <thead>
                    <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-ink-3">
                      <th className="py-1.5">Team</th>
                      <th className="py-1.5 text-right">Proj wins</th>
                      <th className="py-1.5 text-right">Playoffs</th>
                      <th className="py-1.5 text-right">Division</th>
                      <th className="py-1.5 text-right">Power</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.rivals.map((r) => (
                      <tr
                        key={r.teamId}
                        className={`border-t border-line/60 ${r.teamId === detail.teamId ? "text-up" : "text-ink-2"}`}
                      >
                        <td className="py-2 font-sans text-[13px] font-semibold">{r.name}</td>
                        <td className="py-2 text-right">{r.meanWins.toFixed(1)}</td>
                        <td className="py-2 text-right">{fmtPct(r.pPlayoffs, 0)}</td>
                        <td className="py-2 text-right">{fmtPct(r.pDivision, 0)}</td>
                        <td className="py-2 text-right">{r.power > 0 ? "+" : ""}{r.power}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              {/* Unit profile */}
              <Card className="p-5">
                <SectionTitle>Unit profile · EPA/play vs league (2023–25, recency-weighted)</SectionTitle>
                <div className="mt-3 space-y-2.5">
                  <UnitBar label="Pass offense" value={detail.units.passOff - detail.units.league.passOff} higherBetter />
                  <UnitBar label="Rush offense" value={detail.units.rushOff - detail.units.league.rushOff} higherBetter />
                  <UnitBar label="Pass defense" value={detail.units.passDef - detail.units.league.passDef} higherBetter={false} />
                  <UnitBar label="Rush defense" value={detail.units.rushDef - detail.units.league.rushDef} higherBetter={false} />
                </div>
              </Card>

              {/* H2H context */}
              {detail.h2h.length > 0 && (
                <Card className="p-5">
                  <SectionTitle>Recent head-to-head (division rivals)</SectionTitle>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {detail.h2h.map((h) => (
                      <span
                        key={h.oppId}
                        className={`tnum rounded-full border px-3 py-1 font-mono text-xs font-semibold ${
                          h.wins > h.losses
                            ? "border-up-dim/40 text-up"
                            : h.wins < h.losses
                              ? "border-down/40 text-down"
                              : "border-line text-ink-2"
                        }`}
                        title={h.games
                          .map((g) => `${g.season} wk${g.week}: ${g.away} ${g.awayScore} @ ${g.home} ${g.homeScore}`)
                          .join("\n")}
                      >
                        vs {h.oppId}: {h.wins}–{h.losses}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
                    Context for your judgment only — head-to-head records are deliberately NOT a
                    model input (at NFL sample sizes they're noise). If you believe one matters,
                    express it with an injury/news slider.
                  </p>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}

      {!detail && !loading && !error && <EmptyState>Pick a team.</EmptyState>}
    </div>
  );
}

function WinDistChart({ dist }: { dist: WinDistRow[] }) {
  const maxP = Math.max(...dist.map((d) => d.p), 0.01);
  return (
    <div className="mb-5 mt-3">
      <div className="flex items-end gap-1" style={{ height: 110 }}>
        {dist.map((d) => (
          <div
            key={d.wins}
            className="group relative flex-1"
            title={`${d.wins} wins: ${fmtPct(d.p, 1)} of seasons`}
          >
            <div
              className="w-full rounded-t bg-chart-blue transition-opacity group-hover:opacity-100"
              style={{ height: `${(d.p / maxP) * 100}px`, opacity: 0.85 }}
            />
            <span className="tnum absolute -top-4 left-1/2 hidden -translate-x-1/2 font-mono text-[9px] text-ink-2 group-hover:block">
              {fmtPct(d.p, 0)}
            </span>
          </div>
        ))}
      </div>
      <div className="tnum mt-1 flex gap-1 border-t border-line pt-1 font-mono text-[9px] text-ink-3">
        {dist.map((d) => (
          <div key={d.wins} className="flex-1 text-center">{d.wins}</div>
        ))}
      </div>
    </div>
  );
}

function CondChart({
  dist,
  value,
  colorClass,
  outcome,
}: {
  dist: WinDistRow[];
  value: (d: WinDistRow) => number | null;
  colorClass: string;
  outcome: string;
}) {
  return (
    <div className="mb-4 mt-3">
      <div className="flex items-end gap-1" style={{ height: 90 }}>
        {dist.map((d) => {
          const v = value(d);
          return (
            <div
              key={d.wins}
              className="group relative flex-1"
              title={
                v == null
                  ? `${d.wins} wins: never happened in the sims`
                  : `${d.wins} wins → ${fmtPct(v, 0)} ${outcome}`
              }
            >
              <div
                className={`w-full rounded-t transition-opacity group-hover:opacity-100 ${colorClass}`}
                style={{ height: `${(v ?? 0) * 84}px`, opacity: v == null ? 0.15 : 0.85 }}
              />
              <span className="tnum absolute -top-4 left-1/2 hidden -translate-x-1/2 font-mono text-[9px] text-ink-2 group-hover:block">
                {v == null ? "—" : fmtPct(v, 0)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="tnum mt-1 flex gap-1 border-t border-line pt-1 font-mono text-[9px] text-ink-3">
        {dist.map((d) => (
          <div key={d.wins} className="flex-1 text-center">{d.wins}</div>
        ))}
      </div>
    </div>
  );
}

function UnitBar({ label, value, higherBetter }: { label: string; value: number; higherBetter: boolean }) {
  // value is EPA/play deviation from league; ±0.12 is roughly elite/terrible.
  const good = higherBetter ? value > 0 : value < 0;
  const mag = Math.min(1, Math.abs(value) / 0.12);
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-24 shrink-0 font-medium text-ink-2">{label}</span>
      <div className="relative h-3 flex-1 rounded bg-bg">
        <div className="absolute inset-y-0 left-1/2 w-px bg-line-2" />
        <div
          className={`absolute inset-y-0 rounded ${good ? "bg-chart-green" : "bg-chart-red"}`}
          style={
            good
              ? { left: "50%", width: `${mag * 50}%` }
              : { right: "50%", width: `${mag * 50}%` }
          }
          title={`${value >= 0 ? "+" : ""}${value.toFixed(3)} EPA/play vs league`}
        />
      </div>
      <span className={`tnum w-16 shrink-0 text-right font-mono ${good ? "text-up" : "text-down"}`}>
        {value >= 0 ? "+" : ""}
        {value.toFixed(3)}
      </span>
    </div>
  );
}
