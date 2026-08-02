"use client";

import { useEffect, useState } from "react";
import type { Adjustment, QbOverrides } from "../clientTypes";
import type { DecidedGame } from "./FindTab";
import { Card, EmptyState, SectionTitle, Skeleton } from "./ui";

interface Row {
  id: string;
  name: string;
  pos: string;
  team: string;
  depth: number | null;
  ppg: number;
  season: number;
  vorp: number;
  posRank: number;
}

interface Pick {
  round: number;
  overall: number;
  suggestions: (Row & { note: string })[];
}

interface Data {
  scoring: string;
  slot: number;
  teams: number;
  rows: Row[];
  picks: Pick[];
}

export function FantasyTab({
  adjustments,
  decidedGames,
  qbOverrides,
}: {
  adjustments: Adjustment[];
  decidedGames: DecidedGame[];
  qbOverrides: QbOverrides;
}) {
  const [scoring, setScoring] = useState<"ppr" | "half" | "std">("ppr");
  const [slot, setSlot] = useState(5);
  const [teams, setTeams] = useState(12);
  const [pos, setPos] = useState<"ALL" | "QB" | "RB" | "WR" | "TE">("ALL");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/fantasy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scoring, slot, teams, adjustments, decidedGames, qbOverrides }),
    })
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError("Failed to load fantasy projections"))
      .finally(() => setLoading(false));
  }, [scoring, slot, teams, adjustments, decidedGames, qbOverrides]);

  if (error) return <EmptyState>{error}</EmptyState>;
  if (!data) return <Skeleton className="h-96" />;

  const chip = (active: boolean) =>
    `tnum rounded-md border px-2.5 py-1 font-mono text-xs font-bold transition-colors ${
      active ? "border-brand/60 bg-brand/10 text-brand" : "border-line text-ink-3 hover:border-line-2"
    }`;
  const shownRows = data.rows.filter((r) => pos === "ALL" || r.pos === pos).slice(0, 60);

  return (
    <div className={`space-y-4 ${loading ? "opacity-60" : ""} transition-opacity`}>
      <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 p-3">
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Scoring</span>
          {(["ppr", "half", "std"] as const).map((s) => (
            <button key={s} onClick={() => setScoring(s)} className={chip(scoring === s)}>
              {s.toUpperCase()}
            </button>
          ))}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">League</span>
          {[8, 10, 12, 14].map((n) => (
            <button key={n} onClick={() => setTeams(n)} className={chip(teams === n)}>
              {n}
            </button>
          ))}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Your pick</span>
          <select
            value={slot}
            onChange={(e) => setSlot(Number(e.target.value))}
            className="tnum rounded-lg border border-line bg-bg px-2 py-1 font-mono text-xs text-ink"
          >
            {Array.from({ length: teams }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </span>
      </Card>

      {/* Draft assistant */}
      <Card className="p-5">
        <SectionTitle>
          Draft assistant · {data.teams}-team snake, picking {data.slot} · {data.scoring.toUpperCase()}
        </SectionTitle>
        <div className="mt-3 grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
          {data.picks.map((p) => (
            <div key={p.round} className="rounded-lg bg-bg p-3">
              <p className="tnum mb-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">
                Round {p.round} · pick {p.overall} overall
              </p>
              {p.suggestions.map((s, i) => (
                <div key={s.id} className="flex items-center justify-between py-0.5 text-xs">
                  <span className="text-ink">
                    {i === 0 ? "⭐ " : ""}
                    {s.name} <span className="text-[9px] uppercase text-ink-3">{s.pos}{s.posRank} · {s.team}</span>
                  </span>
                  <span className="tnum font-mono text-ink-3">
                    {s.season} pts <span className="text-[9px]">({s.note})</span>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          Assumes the room drafts roughly by our overall board (no public ADP feed is wired), so
          treat availability as approximate — the value ordering is the signal. Suggestions weigh
          value-over-replacement, positional need for a standard 1QB roster, and an early-round QB
          tax. Rookies without NFL stats don't project yet.
        </p>
      </Card>

      {/* Rankings */}
      <Card className="overflow-x-auto p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>Player rankings · schedule-adjusted season projections</SectionTitle>
          <div className="flex gap-1">
            {(["ALL", "QB", "RB", "WR", "TE"] as const).map((p) => (
              <button key={p} onClick={() => setPos(p)} className={chip(pos === p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <table className="tnum mt-3 w-full min-w-[560px] font-mono text-xs">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-ink-3">
              <th className="py-1.5">#</th>
              <th className="py-1.5">Player</th>
              <th className="py-1.5 text-right">Proj pts</th>
              <th className="py-1.5 text-right">PPG</th>
              <th className="py-1.5 text-right">VORP</th>
              <th className="py-1.5 text-right">Depth</th>
            </tr>
          </thead>
          <tbody>
            {shownRows.map((r, i) => (
              <tr key={r.id} className="border-t border-line/60 transition-colors hover:bg-surface-2">
                <td className="py-1.5 text-ink-3">{i + 1}</td>
                <td className="py-1.5 font-sans text-[13px] text-ink">
                  {r.name}{" "}
                  <span className="text-[9px] uppercase text-ink-3">{r.pos}{r.posRank} · {r.team}</span>
                </td>
                <td className="py-1.5 text-right font-bold text-ink">{r.season}</td>
                <td className="py-1.5 text-right text-ink-2">{r.ppg}</td>
                <td className={`py-1.5 text-right ${r.vorp > 0 ? "text-up" : "text-ink-3"}`}>
                  {r.vorp > 0 ? "+" : ""}{r.vorp}
                </td>
                <td className="py-1.5 text-right text-ink-3">{r.depth ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          Every projection is priced against the player's actual 17-game schedule using the same
          matchup engine as the betting model — updated automatically as depth charts, rosters,
          and in-season performance change.
        </p>
      </Card>
    </div>
  );
}
