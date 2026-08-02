"use client";

import { useEffect, useMemo, useState } from "react";
import type { Adjustment, FantasyRoster, QbOverrides } from "../clientTypes";
import type { DecidedGame } from "./FindTab";
import { Card, EmptyState, SectionTitle, Skeleton, Stat, TextInput } from "./ui";

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
  rookie: boolean;
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
  week: number | null;
  weekProj: Record<string, { pts: number; opp: string; home: boolean }> | null;
}

type Mode = "draft" | "rankings" | "startsit" | "trade";

const MODES: { key: Mode; label: string }[] = [
  { key: "draft", label: "Draft assistant" },
  { key: "rankings", label: "Rankings" },
  { key: "startsit", label: "My teams · start/sit" },
  { key: "trade", label: "Trade analyzer" },
];

const STARTERS = [
  { slot: "QB", pos: ["QB"], n: 1 },
  { slot: "RB", pos: ["RB"], n: 2 },
  { slot: "WR", pos: ["WR"], n: 3 },
  { slot: "TE", pos: ["TE"], n: 1 },
  { slot: "FLEX", pos: ["RB", "WR", "TE"], n: 1 },
];

export function FantasyTab({
  adjustments,
  decidedGames,
  qbOverrides,
  rosters,
  setRosters,
}: {
  adjustments: Adjustment[];
  decidedGames: DecidedGame[];
  qbOverrides: QbOverrides;
  rosters: FantasyRoster[];
  setRosters: (r: FantasyRoster[]) => void;
}) {
  const [mode, setMode] = useState<Mode>("draft");
  const [scoring, setScoring] = useState<"ppr" | "half" | "std">("ppr");
  const [slot, setSlot] = useState(5);
  const [teams, setTeams] = useState(12);
  const [week, setWeek] = useState(1);
  const [pos, setPos] = useState<"ALL" | "QB" | "RB" | "WR" | "TE">("ALL");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRoster, setActiveRoster] = useState(0);
  const [search, setSearch] = useState("");
  const [tradeOut, setTradeOut] = useState<string[]>([]);
  const [tradeIn, setTradeIn] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    fetch("/api/fantasy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scoring, slot, teams, week, adjustments, decidedGames, qbOverrides }),
    })
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError("Failed to load fantasy projections"))
      .finally(() => setLoading(false));
  }, [scoring, slot, teams, week, adjustments, decidedGames, qbOverrides]);

  const byId = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.id, r])), [data]);
  const roster = rosters[activeRoster];
  const rosterRows = (roster?.playerIds ?? []).map((id) => byId.get(id)).filter(Boolean) as Row[];

  if (error) return <EmptyState>{error}</EmptyState>;
  if (!data) return <Skeleton className="h-96" />;

  const chip = (active: boolean) =>
    `tnum rounded-md border px-2.5 py-1 font-mono text-xs font-bold transition-colors ${
      active ? "border-brand/60 bg-brand/10 text-brand" : "border-line text-ink-3 hover:border-line-2"
    }`;

  // Start/sit: fill lineup slots greedily by this week's projection.
  const lineup = (() => {
    const proj = data.weekProj ?? {};
    const pool = [...rosterRows].sort((a, b) => (proj[b.id]?.pts ?? 0) - (proj[a.id]?.pts ?? 0));
    const used = new Set<string>();
    const filled: { slot: string; row: Row | null }[] = [];
    for (const s of STARTERS) {
      for (let i = 0; i < s.n; i++) {
        const pick = pool.find((r) => !used.has(r.id) && s.pos.includes(r.pos));
        if (pick) used.add(pick.id);
        filled.push({ slot: s.slot, row: pick ?? null });
      }
    }
    return { filled, bench: pool.filter((r) => !used.has(r.id)) };
  })();

  const tradeDelta =
    tradeIn.reduce((a, id) => a + (byId.get(id)?.season ?? 0), 0) -
    tradeOut.reduce((a, id) => a + (byId.get(id)?.season ?? 0), 0);
  const tradeVorpDelta =
    tradeIn.reduce((a, id) => a + (byId.get(id)?.vorp ?? 0), 0) -
    tradeOut.reduce((a, id) => a + (byId.get(id)?.vorp ?? 0), 0);

  const searchRows = data.rows
    .filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 12);

  return (
    <div className={`space-y-4 ${loading ? "opacity-60" : ""} transition-opacity`}>
      {/* Mode + global settings */}
      <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 p-3">
        <span className="flex gap-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                mode === m.key ? "border-up-dim/60 bg-up/10 text-up" : "border-line text-ink-3 hover:border-line-2"
              }`}
            >
              {m.label}
            </button>
          ))}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Scoring</span>
          {(["ppr", "half", "std"] as const).map((s) => (
            <button key={s} onClick={() => setScoring(s)} className={chip(scoring === s)}>
              {s.toUpperCase()}
            </button>
          ))}
        </span>
        {mode === "draft" && (
          <>
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
          </>
        )}
        {mode === "startsit" && (
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Week</span>
            <select
              value={week}
              onChange={(e) => setWeek(Number(e.target.value))}
              className="tnum rounded-lg border border-line bg-bg px-2 py-1 font-mono text-xs text-ink"
            >
              {Array.from({ length: 18 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </span>
        )}
      </Card>

      {/* DRAFT */}
      {mode === "draft" && (
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
                      {s.name}{" "}
                      <span className="text-[9px] uppercase text-ink-3">
                        {s.pos}{s.posRank} · {s.team}{s.rookie ? " · R" : ""}
                      </span>
                    </span>
                    <span className="tnum font-mono text-ink-3">
                      {s.season} <span className="text-[9px]">({s.note})</span>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            Assumes the room drafts by our board (no ADP feed) — the value ordering is the signal.
            Rookies (marked <b>R</b>) project from draft capital, the best public year-1 predictor.
          </p>
        </Card>
      )}

      {/* RANKINGS */}
      {mode === "rankings" && (
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
          <table className="tnum mt-3 w-full min-w-[600px] font-mono text-xs">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-ink-3">
                <th className="py-1.5">#</th>
                <th className="py-1.5">Player</th>
                <th className="py-1.5 text-right">Proj</th>
                <th className="py-1.5 text-right">PPG</th>
                <th className="py-1.5 text-right">VORP</th>
                <th className="py-1.5 text-right">Add</th>
              </tr>
            </thead>
            <tbody>
              {data.rows
                .filter((r) => pos === "ALL" || r.pos === pos)
                .slice(0, 80)
                .map((r, i) => (
                  <tr key={r.id} className="border-t border-line/60 transition-colors hover:bg-surface-2">
                    <td className="py-1.5 text-ink-3">{i + 1}</td>
                    <td className="py-1.5 font-sans text-[13px] text-ink">
                      {r.name}{" "}
                      <span className="text-[9px] uppercase text-ink-3">
                        {r.pos}{r.posRank} · {r.team}
                      </span>
                      {r.rookie && <span className="ml-1 rounded bg-brand/15 px-1 text-[9px] font-bold text-brand">R</span>}
                    </td>
                    <td className="py-1.5 text-right font-bold text-ink">{r.season}</td>
                    <td className="py-1.5 text-right text-ink-2">{r.ppg}</td>
                    <td className={`py-1.5 text-right ${r.vorp > 0 ? "text-up" : "text-ink-3"}`}>
                      {r.vorp > 0 ? "+" : ""}{r.vorp}
                    </td>
                    <td className="py-1.5 text-right">
                      {roster && (
                        <button
                          onClick={() => {
                            if (roster.playerIds.includes(r.id)) return;
                            const next = [...rosters];
                            next[activeRoster] = { ...roster, playerIds: [...roster.playerIds, r.id] };
                            setRosters(next);
                          }}
                          className="rounded border border-line px-1.5 text-[10px] text-ink-3 hover:border-up-dim/60 hover:text-up"
                        >
                          + {roster.name}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* MY TEAMS / START-SIT */}
      {mode === "startsit" && (
        <div className="space-y-4">
          <Card className="flex flex-wrap items-center gap-2 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">My teams</span>
            {rosters.map((r, i) => (
              <button
                key={r.id}
                onClick={() => setActiveRoster(i)}
                className={`rounded-lg border px-3 py-1 text-xs font-bold ${
                  activeRoster === i ? "border-up-dim/60 bg-up/10 text-up" : "border-line text-ink-3"
                }`}
              >
                {r.name} <span className="text-[9px] opacity-70">({r.playerIds.length})</span>
              </button>
            ))}
            <button
              onClick={() => {
                const name = `Team ${rosters.length + 1}`;
                setRosters([...rosters, { id: `${Date.now()}`, name, playerIds: [] }]);
                setActiveRoster(rosters.length);
              }}
              className="rounded-lg border border-line px-3 py-1 text-xs font-semibold text-ink-2 hover:border-line-2"
            >
              + New team
            </button>
            {roster && (
              <button
                onClick={() => {
                  setRosters(rosters.filter((_, i) => i !== activeRoster));
                  setActiveRoster(0);
                }}
                className="ml-auto text-[11px] text-down hover:underline"
              >
                Delete {roster.name}
              </button>
            )}
          </Card>

          {!roster ? (
            <EmptyState>
              Create a team, then add players from the Rankings tab (+ button) or the search box
              that appears here. Rosters are saved and synced across your devices.
            </EmptyState>
          ) : (
            <>
              <Card className="p-4">
                <SectionTitle>Add players to {roster.name}</SectionTitle>
                <div className="mt-2 max-w-md">
                  <TextInput
                    placeholder="Search a player to add…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {search && (
                  <div className="mt-2 space-y-1">
                    {searchRows.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => {
                          if (!roster.playerIds.includes(r.id)) {
                            const next = [...rosters];
                            next[activeRoster] = { ...roster, playerIds: [...roster.playerIds, r.id] };
                            setRosters(next);
                          }
                          setSearch("");
                        }}
                        className="flex w-full items-center justify-between rounded-lg bg-bg px-3 py-1.5 text-left text-xs hover:bg-surface-2"
                      >
                        <span className="text-ink">
                          {r.name} <span className="text-[9px] uppercase text-ink-3">{r.pos} · {r.team}</span>
                        </span>
                        <span className="tnum font-mono text-ink-3">{r.season} pts</span>
                      </button>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-5">
                <SectionTitle>
                  Week {data.week} optimal lineup · {roster.name}
                </SectionTitle>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-up">Start</p>
                    {lineup.filled.map((f, i) => {
                      const p = f.row ? data.weekProj?.[f.row.id] : null;
                      return (
                        <div key={i} className="flex items-center justify-between border-b border-line/40 py-1 text-xs">
                          <span>
                            <span className="mr-2 inline-block w-9 font-mono text-[10px] font-bold text-ink-3">{f.slot}</span>
                            {f.row ? (
                              <span className="text-ink">
                                {f.row.name}{" "}
                                <span className="text-[9px] text-ink-3">
                                  {p ? `${p.home ? "vs" : "@"} ${p.opp}` : "bye"}
                                </span>
                              </span>
                            ) : (
                              <span className="text-ink-3">— empty —</span>
                            )}
                          </span>
                          <span className="tnum font-mono font-bold text-ink">{p ? p.pts.toFixed(1) : "—"}</span>
                        </div>
                      );
                    })}
                    <div className="mt-2 flex justify-between text-xs font-bold">
                      <span className="text-ink-2">Projected total</span>
                      <span className="tnum font-mono text-up">
                        {lineup.filled
                          .reduce((a, f) => a + (f.row ? data.weekProj?.[f.row.id]?.pts ?? 0 : 0), 0)
                          .toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-3">Bench</p>
                    {lineup.bench.map((r) => {
                      const p = data.weekProj?.[r.id];
                      return (
                        <div key={r.id} className="flex items-center justify-between border-b border-line/40 py-1 text-xs">
                          <span className="text-ink-2">
                            {r.name} <span className="text-[9px] uppercase text-ink-3">{r.pos}</span>{" "}
                            <span className="text-[9px] text-ink-3">{p ? `${p.home ? "vs" : "@"} ${p.opp}` : "bye"}</span>
                          </span>
                          <span className="tnum flex items-center gap-2 font-mono text-ink-3">
                            {p ? p.pts.toFixed(1) : "—"}
                            <button
                              onClick={() => {
                                const next = [...rosters];
                                next[activeRoster] = {
                                  ...roster,
                                  playerIds: roster.playerIds.filter((id) => id !== r.id),
                                };
                                setRosters(next);
                              }}
                              className="text-ink-3 hover:text-down"
                            >
                              ✕
                            </button>
                          </span>
                        </div>
                      );
                    })}
                    {lineup.bench.length === 0 && <p className="text-xs text-ink-3">No bench players.</p>}
                  </div>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
                  Lineup is filled greedily by this week's matchup projection (opponent units, rest,
                  your QB/injury settings). Players on bye show no projection.
                </p>
              </Card>
            </>
          )}
        </div>
      )}

      {/* TRADE */}
      {mode === "trade" && (
        <div className="space-y-4">
          <Card className="p-4">
            <SectionTitle>Trade analyzer · rest-of-season value</SectionTitle>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {([
                ["You give", tradeOut, setTradeOut] as const,
                ["You get", tradeIn, setTradeIn] as const,
              ]).map(([label, list, setList]) => (
                <div key={label}>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-3">{label}</p>
                  <select
                    onChange={(e) => {
                      if (e.target.value) setList([...list, e.target.value]);
                      e.target.value = "";
                    }}
                    className="w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-xs text-ink"
                  >
                    <option value="">Add a player…</option>
                    {data.rows.slice(0, 200).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.pos} · {r.team}) — {r.season}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1.5 space-y-1">
                    {list.map((id) => {
                      const r = byId.get(id);
                      if (!r) return null;
                      return (
                        <div key={id} className="flex items-center justify-between rounded-lg bg-bg px-3 py-1.5 text-xs">
                          <span className="text-ink">
                            {r.name} <span className="text-[9px] uppercase text-ink-3">{r.pos}{r.posRank}</span>
                          </span>
                          <span className="tnum flex items-center gap-2 font-mono text-ink-3">
                            {r.season} · VORP {r.vorp > 0 ? "+" : ""}{r.vorp}
                            <button onClick={() => setList(list.filter((x) => x !== id))} className="hover:text-down">✕</button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          {(tradeIn.length > 0 || tradeOut.length > 0) && (
            <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
              <Stat
                label="Points swing"
                value={`${tradeDelta >= 0 ? "+" : ""}${Math.round(tradeDelta)}`}
                tone={tradeDelta >= 0 ? "good" : "bad"}
                size="xl"
                glow
              />
              <Stat
                label="VORP swing (roster impact)"
                value={`${tradeVorpDelta >= 0 ? "+" : ""}${Math.round(tradeVorpDelta)}`}
                tone={tradeVorpDelta >= 0 ? "good" : "bad"}
                size="xl"
              />
              <span
                className={`rounded-full px-4 py-1.5 text-sm font-extrabold ${
                  tradeVorpDelta > 15 ? "bg-up/15 text-up" : tradeVorpDelta < -15 ? "bg-down/15 text-down" : "bg-surface-3 text-ink-2"
                }`}
              >
                {tradeVorpDelta > 15 ? "ACCEPT" : tradeVorpDelta < -15 ? "DECLINE" : "ROUGHLY EVEN"}
              </span>
              <p className="w-full text-[11px] leading-relaxed text-ink-3">
                VORP swing is the honest measure — raw points favor whoever gets more bodies, while
                value-over-replacement accounts for the fact that you can stream a replacement.
                Consolidating two mid players into one stud usually shows a small VORP gain and is
                usually right in a starting lineup.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
