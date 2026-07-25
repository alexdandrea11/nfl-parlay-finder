"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtAmerican, fmtMoney, fmtOdds, fmtPct } from "@/lib/format";
import {
  MARKETS,
  loadLS,
  saveLS,
  type Adjustment,
  type CustomBoard,
  type MarketType,
  type Parlay,
  type QbInfo,
  type QbOverrides,
  type SavedSearch,
  type SavedTicket,
  type ScheduledGame,
  type SearchResponse,
  type TeamMeta,
} from "../clientTypes";
import {
  BOOK_LABEL,
  Card,
  Chip,
  EmptyState,
  Field,
  NumInput,
  SectionTitle,
  Skeleton,
  Stat,
  TextInput,
  Toggle,
} from "./ui";

const SORTS = [
  { key: "value", label: "Best value", hint: "EV per unit of risk" },
  { key: "ev", label: "Highest EV", hint: "expected return" },
  { key: "prob", label: "Most likely", hint: "highest win probability" },
  { key: "payout", label: "Biggest payout", hint: "longest odds" },
];

type TriState = "none" | "include" | "exclude";

export interface DecidedGame {
  homeId: string;
  awayId: string;
  winnerId: string;
}

export function FindTab({
  teams,
  sims,
  adjustments,
  setAdjustments,
  decidedGames,
  setDecidedGames,
  qbOverrides,
  qbs,
  schedule,
  customBoard,
  autoSync,
  setAutoSync,
  onAddTicket,
}: {
  teams: TeamMeta[];
  sims: number;
  adjustments: Adjustment[];
  setAdjustments: (a: Adjustment[]) => void;
  decidedGames: DecidedGame[];
  setDecidedGames: (g: DecidedGame[]) => void;
  qbOverrides: QbOverrides;
  qbs: QbInfo[];
  schedule: ScheduledGame[];
  customBoard: CustomBoard;
  autoSync: boolean;
  setAutoSync: (v: boolean) => void;
  onAddTicket: (t: SavedTicket) => void;
}) {
  const [minLegs, setMinLegs] = useState(2);
  const [maxLegs, setMaxLegs] = useState(3);
  const [markets, setMarkets] = useState<Set<MarketType>>(new Set(MARKETS.map((m) => m.key)));
  const [sortBy, setSortBy] = useState("value");
  const [minWinProb, setMinWinProb] = useState(0.1);
  const [minEv, setMinEv] = useState(0);
  const [minPayout, setMinPayout] = useState("");
  const [maxPayout, setMaxPayout] = useState("");
  const [allowCorrelated, setAllowCorrelated] = useState(false);
  const [anchorWeight, setAnchorWeight] = useState(0.3);
  const [requireLineShopEdge, setRequireLineShopEdge] = useState(false);
  const [maxDivergence, setMaxDivergence] = useState<number>(0.15);
  const [divergenceOn, setDivergenceOn] = useState(true);
  const [bankroll, setBankroll] = useState(1000);
  const [kellyMult, setKellyMult] = useState(0.25);
  const [teamState, setTeamState] = useState<Record<string, TriState>>({});
  const [showTeams, setShowTeams] = useState(false);
  const [showInjuries, setShowInjuries] = useState(false);
  const [showSeason, setShowSeason] = useState(false);

  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  const [saved, setSaved] = useState<SavedSearch[]>(() => loadLS("nfl-saved-searches", []));
  const [saveName, setSaveName] = useState("");
  const [runningAlerts, setRunningAlerts] = useState(false);
  const [cronAlerts, setCronAlerts] = useState<{
    at: number;
    items: { id: string; name: string; count: number; topEv: number | null; triggered: boolean }[];
  } | null>(null);

  useEffect(() => {
    fetch("/api/alerts")
      .then((r) => r.json())
      .then((d) => {
        if (d?.at) setCronAlerts(d);
      })
      .catch(() => {});
  }, []);

  const [moonStake, setMoonStake] = useState(100);
  const [moonMultiple, setMoonMultiple] = useState(300);
  const [moonResult, setMoonResult] = useState<{ parlays: Parlay[]; targetAmerican: number } | null>(null);
  const [moonLoading, setMoonLoading] = useState(false);
  const [seasonWeek, setSeasonWeek] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const includeTeams = useMemo(
    () => Object.entries(teamState).filter(([, v]) => v === "include").map(([k]) => k),
    [teamState],
  );
  const excludeTeams = useMemo(
    () => Object.entries(teamState).filter(([, v]) => v === "exclude").map(([k]) => k),
    [teamState],
  );

  function buildBody(): Record<string, unknown> {
    return {
      minLegs,
      maxLegs,
      markets: Array.from(markets),
      includeTeams,
      excludeTeams,
      maxLegsPerTeam: allowCorrelated ? 3 : 1,
      minWinProb,
      minEv,
      minPayoutAmerican: minPayout,
      maxPayoutAmerican: maxPayout,
      allowCorrelated,
      anchorWeight,
      maxDivergence: divergenceOn ? maxDivergence : null,
      requireLineShopEdge,
      sortBy,
      limit: 30,
      bankroll,
      kellyMultiplier: kellyMult,
      adjustments,
      decidedGames,
      qbOverrides,
      customBoard,
    };
  }

  async function runSearch(bodyOverride?: Record<string, unknown>): Promise<SearchResponse | null> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyOverride ?? buildBody()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setResult(data);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      return null;
    } finally {
      setLoading(false);
    }
  }

  function saveCurrentSearch() {
    const name = saveName.trim() || `Search ${saved.length + 1}`;
    const s: SavedSearch = {
      id: `${Date.now()}`,
      name,
      createdAt: Date.now(),
      body: buildBody(),
      alertMinEv: Math.max(minEv, 0.1),
    };
    const next = [...saved, s];
    setSaved(next);
    saveLS("nfl-saved-searches", next);
    setSaveName("");
  }

  async function runAllAlerts() {
    setRunningAlerts(true);
    const next = [...saved];
    for (let i = 0; i < next.length; i++) {
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...next[i].body, adjustments, decidedGames, qbOverrides, customBoard, limit: 5 }),
        });
        const data = (await res.json()) as SearchResponse;
        next[i] = {
          ...next[i],
          lastRun: Date.now(),
          lastCount: data.parlays?.length ?? 0,
          lastTopEv: data.parlays?.[0]?.ev ?? null,
        };
      } catch {
        // leave stale on failure
      }
    }
    setSaved(next);
    saveLS("nfl-saved-searches", next);
    setRunningAlerts(false);
  }

  function deleteSaved(id: string) {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    saveLS("nfl-saved-searches", next);
  }

  function setAdj(teamId: string, delta: number) {
    const next = adjustments.filter((a) => a.teamId !== teamId);
    if (delta !== 0) next.push({ teamId, delta });
    setAdjustments(next);
  }

  /** Toggle a game result: click winner to set, click again to unset. */
  function toggleResult(g: ScheduledGame, winnerId: string) {
    const existing = decidedGames.find((d) => d.homeId === g.home && d.awayId === g.away);
    if (existing?.winnerId === winnerId) {
      setDecidedGames(decidedGames.filter((d) => d !== existing));
    } else {
      setDecidedGames([
        ...decidedGames.filter((d) => d !== existing),
        { homeId: g.home, awayId: g.away, winnerId },
      ]);
    }
  }

  async function syncResults() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/season-sync");
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "sync failed");
      const synced = (d.decidedGames ?? []).map(
        (g: { homeId: string; awayId: string; winnerId: string }) => ({
          homeId: g.homeId,
          awayId: g.awayId,
          winnerId: g.winnerId,
        }),
      );
      setDecidedGames(synced);
      setSyncMsg(
        synced.length === 0
          ? `No ${d.season} games have been played yet — nothing to sync.`
          : `Synced ${synced.length} real results.`,
      );
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const weekGames = schedule.filter((g) => g.week === seasonWeek);
  const weeks = [...new Set(schedule.map((g) => g.week))].sort((a, b) => a - b);

  async function runMoonshot() {
    setMoonLoading(true);
    try {
      const res = await fetch("/api/moonshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stake: moonStake,
          targetMultiple: moonMultiple,
          adjustments,
          decidedGames,
          qbOverrides,
          customBoard,
        }),
      });
      const d = await res.json();
      if (!d.error) setMoonResult(d);
    } finally {
      setMoonLoading(false);
    }
  }

  function copySlip(p: Parlay, i: number) {
    const lines = p.legs.map((l) => `  • ${l.label} (${fmtAmerican(l.americanOdds)})`);
    const text = `NFL Parlay — ${fmtAmerican(p.combinedAmerican)} | win ${fmtPct(p.jointProb)} | EV ${fmtPct(p.ev, 1)}\n${lines.join("\n")}`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
    });
  }

  function addToPortfolio(p: Parlay, i: number) {
    const stake = Math.max(1, Math.round(bankroll * p.kellyFraction));
    onAddTicket({ legIds: p.legs.map((l) => l.id), stake });
    setAdded(i);
    setTimeout(() => setAdded((a) => (a === i ? null : a)), 1500);
  }

  const activeAdjustments = adjustments.filter((a) => a.delta !== 0);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
      {/* Builder column */}
      <div className="space-y-4">
        <Card className="space-y-4 p-4">
          <SectionTitle>Build your search</SectionTitle>

          <Field label="Legs per parlay">
            <div className="flex items-center gap-2 text-sm">
              <NumInput value={minLegs} min={2} max={8} onChange={(v) => setMinLegs(Math.min(v, maxLegs))} />
              <span className="text-ink-3">to</span>
              <NumInput value={maxLegs} min={minLegs} max={8} onChange={(v) => setMaxLegs(Math.max(v, minLegs))} />
            </div>
          </Field>

          <Field label="Markets to combine">
            <div className="flex flex-wrap gap-1.5">
              {MARKETS.map((m) => (
                <Chip
                  key={m.key}
                  active={markets.has(m.key)}
                  onClick={() =>
                    setMarkets((prev) => {
                      const next = new Set(prev);
                      if (next.has(m.key)) next.delete(m.key);
                      else next.add(m.key);
                      return next;
                    })
                  }
                >
                  {m.label}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Rank by">
            <div className="grid grid-cols-2 gap-1.5">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSortBy(s.key)}
                  className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                    sortBy === s.key
                      ? "border-up-dim/60 bg-up/10 text-up"
                      : "border-line text-ink-2 hover:border-line-2"
                  }`}
                >
                  <div className="font-bold">{s.label}</div>
                  <div className="mt-0.5 text-[10px] opacity-70">{s.hint}</div>
                </button>
              ))}
            </div>
          </Field>

          <Field label={`Min win probability · ${fmtPct(minWinProb, 0)}`}>
            <input
              type="range"
              min={0}
              max={0.9}
              step={0.01}
              value={minWinProb}
              onChange={(e) => setMinWinProb(Number(e.target.value))}
              className="w-full text-up"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Min EV">
              <div className="flex items-center gap-1.5 text-sm">
                <NumInput value={Math.round(minEv * 100)} min={-100} max={500} onChange={(v) => setMinEv(v / 100)} />
                <span className="text-ink-3">%</span>
              </div>
            </Field>
            <Field label="Correlated legs">
              <Toggle on={allowCorrelated} onChange={setAllowCorrelated} labelOn="Allowed" labelOff="Blocked" />
            </Field>
          </div>

          <Field
            label={`Market anchor · ${Math.round(anchorWeight * 100)}% ${
              anchorWeight === 0 ? "(pure model)" : anchorWeight >= 0.99 ? "(pure market)" : ""
            }`}
          >
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={anchorWeight}
              onChange={(e) => setAnchorWeight(Number(e.target.value))}
              className="w-full text-brand"
            />
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-3">
              Blends our probabilities toward street consensus before computing EV and stakes —
              conviction "within reason." 0% = trust the model alone.
            </p>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="FD best-priced only">
              <Toggle on={requireLineShopEdge} onChange={setRequireLineShopEdge} labelOn="On" labelOff="Off" />
            </Field>
            <Field label={`Trust filter${divergenceOn ? ` · ±${Math.round(maxDivergence * 100)}pp` : ""}`}>
              <Toggle on={divergenceOn} onChange={setDivergenceOn} labelOn="On" labelOff="Off" />
            </Field>
          </div>
          {divergenceOn && (
            <Field label="Max model-vs-market divergence">
              <input
                type="range"
                min={0.02}
                max={0.4}
                step={0.01}
                value={maxDivergence}
                onChange={(e) => setMaxDivergence(Number(e.target.value))}
                className="w-full text-brand"
              />
              <p className="mt-1.5 text-[10px] leading-relaxed text-ink-3">
                Drops legs where the model disagrees with market consensus by more than{" "}
                {Math.round(maxDivergence * 100)} points — big disagreement is usually model error,
                not edge.
              </p>
            </Field>
          )}

          <Field label="Payout window (American, optional)">
            <div className="flex items-center gap-2 text-sm">
              <TextInput placeholder="min +" value={minPayout} onChange={(e) => setMinPayout(e.target.value)} inputMode="numeric" />
              <span className="text-ink-3">–</span>
              <TextInput placeholder="max +" value={maxPayout} onChange={(e) => setMaxPayout(e.target.value)} inputMode="numeric" />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Bankroll">
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-ink-3">$</span>
                <NumInput value={bankroll} min={0} max={1000000} onChange={setBankroll} wide />
              </div>
            </Field>
            <Field label={`Kelly · ${(kellyMult * 100).toFixed(0)}%`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={kellyMult}
                onChange={(e) => setKellyMult(Number(e.target.value))}
                className="mt-2.5 w-full text-up"
              />
            </Field>
          </div>

          <div>
            <button
              onClick={() => setShowTeams((s) => !s)}
              className="text-xs font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
            >
              {showTeams ? "▾ Hide" : "▸ Filter"} teams
              {includeTeams.length + excludeTeams.length > 0 &&
                ` (${includeTeams.length} in, ${excludeTeams.length} out)`}
            </button>
            {showTeams && (
              <div className="mt-2 grid grid-cols-4 gap-1">
                {teams.map((t) => {
                  const st = teamState[t.id] ?? "none";
                  return (
                    <button
                      key={t.id}
                      onClick={() =>
                        setTeamState((prev) => {
                          const cur = prev[t.id] ?? "none";
                          const next: TriState =
                            cur === "none" ? "include" : cur === "include" ? "exclude" : "none";
                          return { ...prev, [t.id]: next };
                        })
                      }
                      className={`rounded-md border px-1 py-1.5 font-mono text-[10px] font-bold transition-colors ${
                        st === "include"
                          ? "border-up-dim/60 bg-up/10 text-up"
                          : st === "exclude"
                            ? "border-down/50 bg-down/10 text-down line-through"
                            : "border-line text-ink-3 hover:border-line-2 hover:text-ink-2"
                      }`}
                      title={`${t.name} · ${t.conference} ${t.division}`}
                    >
                      {t.id}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            onClick={() => runSearch()}
            disabled={loading || markets.size === 0}
            className="w-full rounded-lg bg-up py-2.5 text-sm font-bold text-[#03271c] transition hover:bg-up-dim disabled:opacity-40"
          >
            {loading ? "Simulating…" : "Find parlays"}
          </button>

          <div className="flex items-center gap-2">
            <TextInput
              placeholder="Save this search as…"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              className="text-xs"
            />
            <button
              onClick={saveCurrentSearch}
              className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
            >
              Save
            </button>
          </div>
        </Card>

        {/* Moonshot finder */}
        <Card className="space-y-3 border-warn/30 p-4">
          <SectionTitle>🚀 Moonshot finder</SectionTitle>
          <p className="text-[11px] leading-relaxed text-ink-3">
            The most-likely ticket (pure model, no anchor) that pays a giant multiple. It hunts
            same-team ladders — division + conference + Super Bowl multiply the payout while the
            real probability stays the deepest rung.
          </p>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-3">$</span>
            <NumInput value={moonStake} min={1} max={100000} onChange={setMoonStake} />
            <span className="text-ink-3">to win ≥</span>
            <select
              value={moonMultiple}
              onChange={(e) => setMoonMultiple(Number(e.target.value))}
              className="rounded-lg border border-line bg-bg px-2 py-1.5 text-xs text-ink"
            >
              {[100, 300, 500, 1000].map((m) => (
                <option key={m} value={m}>
                  {m}x (${(moonStake * m).toLocaleString()})
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={runMoonshot}
            disabled={moonLoading}
            className="w-full rounded-lg bg-warn/90 py-2 text-sm font-bold text-[#2a1f03] transition hover:bg-warn disabled:opacity-50"
          >
            {moonLoading ? "Hunting…" : "Find moonshots"}
          </button>
        </Card>

        {/* Injuries / rating adjustments */}
        <Card className="p-4">
          <button onClick={() => setShowInjuries((s) => !s)} className="w-full text-left">
            <SectionTitle>
              {showInjuries ? "▾" : "▸"} Injury / news adjustments
              {activeAdjustments.length > 0 && (
                <span className="ml-2 rounded-full bg-warn/10 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-warn">
                  {activeAdjustments.length} active
                </span>
              )}
            </SectionTitle>
          </button>
          {showInjuries && (
            <div className="mt-3 space-y-2">
              <p className="text-[11px] leading-relaxed text-ink-3">
                Nudge a team's power rating when news breaks (star QB out ≈ −80 to −120). Market
                prices stay fixed, so your adjustment shows up as edge for/against that team.
              </p>
              {teams.map((t) => {
                const adj = adjustments.find((a) => a.teamId === t.id)?.delta ?? 0;
                return (
                  <div key={t.id} className="flex items-center gap-2 text-xs">
                    <span className="w-9 shrink-0 font-mono font-bold text-ink-2">{t.id}</span>
                    <input
                      type="range"
                      min={-150}
                      max={150}
                      step={10}
                      value={adj}
                      onChange={(e) => setAdj(t.id, Number(e.target.value))}
                      className={`w-full ${adj === 0 ? "text-line-2" : adj > 0 ? "text-up" : "text-down"}`}
                    />
                    <span
                      className={`tnum w-10 shrink-0 text-right font-mono font-semibold ${
                        adj > 0 ? "text-up" : adj < 0 ? "text-down" : "text-ink-3"
                      }`}
                    >
                      {adj > 0 ? `+${adj}` : adj}
                    </span>
                  </div>
                );
              })}
              {activeAdjustments.length > 0 && (
                <button
                  onClick={() => setAdjustments([])}
                  className="text-[11px] font-medium text-down underline-offset-2 hover:underline"
                >
                  Clear all adjustments
                </button>
              )}
            </div>
          )}
        </Card>

        {/* In-season results */}
        <Card className="p-4">
          <button onClick={() => setShowSeason((s) => !s)} className="w-full text-left">
            <SectionTitle>
              {showSeason ? "▾" : "▸"} Season so far
              {decidedGames.length > 0 && (
                <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-brand">
                  {decidedGames.length} results
                </span>
              )}
            </SectionTitle>
          </button>
          {showSeason && (
            <div className="mt-3 space-y-2.5">
              <p className="text-[11px] leading-relaxed text-ink-3">
                Mark results on the real 2026 schedule (or sync them automatically) and the
                simulation replays only the remaining games — live probabilities for open tickets.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={syncResults}
                  disabled={syncing}
                  className="rounded-lg bg-brand/15 px-3 py-1.5 text-xs font-bold text-brand transition-colors hover:bg-brand/25 disabled:opacity-50"
                >
                  {syncing ? "Syncing…" : "⟳ Sync now"}
                </button>
                <button
                  onClick={() => setAutoSync(!autoSync)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    autoSync
                      ? "border-up-dim/60 bg-up/10 text-up"
                      : "border-line text-ink-3 hover:border-line-2"
                  }`}
                  title="Automatically pull played-game results every time the app loads"
                >
                  Auto-sync {autoSync ? "on" : "off"}
                </button>
                {decidedGames.length > 0 && (
                  <button
                    onClick={() => setDecidedGames([])}
                    className="text-[11px] font-medium text-down underline-offset-2 hover:underline"
                  >
                    Clear all ({decidedGames.length})
                  </button>
                )}
              </div>
              {syncMsg && <p className="text-[11px] text-ink-2">{syncMsg}</p>}
              <div className="flex flex-wrap gap-1">
                {weeks.map((w) => {
                  const decidedInWeek = schedule.filter(
                    (g) => g.week === w && decidedGames.some((d) => d.homeId === g.home && d.awayId === g.away),
                  ).length;
                  return (
                    <button
                      key={w}
                      onClick={() => setSeasonWeek(w)}
                      className={`tnum rounded-md border px-1.5 py-1 font-mono text-[10px] font-bold transition-colors ${
                        seasonWeek === w
                          ? "border-brand/60 bg-brand/10 text-brand"
                          : decidedInWeek > 0
                            ? "border-up-dim/40 text-up"
                            : "border-line text-ink-3 hover:border-line-2"
                      }`}
                      title={`Week ${w}${decidedInWeek ? ` · ${decidedInWeek} results entered` : ""}`}
                    >
                      {w}
                    </button>
                  );
                })}
              </div>
              <div className="space-y-1">
                {weekGames.map((g) => {
                  const decided = decidedGames.find((d) => d.homeId === g.home && d.awayId === g.away);
                  const side = (id: string) => (
                    <button
                      onClick={() => toggleResult(g, id)}
                      className={`tnum w-14 rounded-md border px-1.5 py-1 font-mono text-[11px] font-bold transition-colors ${
                        decided?.winnerId === id
                          ? "border-up-dim/60 bg-up/15 text-up"
                          : decided
                            ? "border-line text-ink-3/50 line-through"
                            : "border-line text-ink-2 hover:border-line-2 hover:text-ink"
                      }`}
                      title={decided?.winnerId === id ? "Click to unset" : `${id} won`}
                    >
                      {id}
                    </button>
                  );
                  return (
                    <div key={`${g.home}${g.away}`} className="flex items-center gap-1.5 text-[11px] text-ink-3">
                      {side(g.away)}
                      <span>@</span>
                      {side(g.home)}
                    </div>
                  );
                })}
                {weekGames.length === 0 && (
                  <p className="text-[11px] text-ink-3">No games this week.</p>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Saved searches / alerts */}
        {saved.length > 0 && (
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>Saved searches · alerts</SectionTitle>
              <button
                onClick={runAllAlerts}
                disabled={runningAlerts}
                className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 transition-colors hover:border-line-2 hover:text-ink disabled:opacity-50"
              >
                {runningAlerts ? "Checking…" : "Check all now"}
              </button>
            </div>
            <div className="mt-2.5 space-y-1.5">
              {saved.map((s) => {
                // Prefer the daily cron's sweep when it's fresher than the
                // last manual check.
                const cron = cronAlerts?.items.find((i) => i.id === s.id);
                const useCron = cron && (!s.lastRun || (cronAlerts?.at ?? 0) > s.lastRun);
                const lastRun = useCron ? cronAlerts!.at : s.lastRun;
                const lastCount = useCron ? cron.count : s.lastCount;
                const lastTopEv = useCron ? cron.topEv : s.lastTopEv;
                const alerting =
                  lastTopEv != null && lastTopEv >= s.alertMinEv && (lastCount ?? 0) > 0;
                return (
                  <div key={s.id} className="flex items-center justify-between rounded-lg bg-bg px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      {alerting && <span className="live-dot inline-block h-2 w-2 rounded-full bg-up" title="Alert: EV above threshold" />}
                      <span className="font-semibold">{s.name}</span>
                      {lastRun && (
                        <span className="tnum font-mono text-ink-3">
                          {lastCount} hits{lastTopEv != null && ` · top EV ${fmtPct(lastTopEv, 0)}`}
                          {useCron && <span className="ml-1 text-brand" title="From the daily automatic sweep">auto</span>}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <button
                        onClick={() => runSearch({ ...s.body, adjustments, decidedGames, qbOverrides, customBoard })}
                        className="font-semibold text-brand hover:underline"
                      >
                        Run
                      </button>
                      <button onClick={() => deleteSaved(s.id)} className="text-down">✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {/* Results column */}
      <div className="space-y-3">
        {error && (
          <div className="rounded-lg border border-down/40 bg-down/10 p-3 text-sm text-down">{error}</div>
        )}

        {(activeAdjustments.length > 0 || decidedGames.length > 0 || Object.keys(qbOverrides).length > 0) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-warn/25 bg-warn/5 px-3.5 py-2 text-xs font-medium text-warn">
            {activeAdjustments.length > 0 && (
              <span>
                Model adjusted:{" "}
                {activeAdjustments.map((a) => `${a.teamId} ${a.delta > 0 ? "+" : ""}${a.delta}`).join(", ")}
              </span>
            )}
            {Object.keys(qbOverrides).length > 0 && (
              <span>
                QB swaps:{" "}
                {Object.entries(qbOverrides)
                  .map(([t, q]) => `${t} → ${q === "replacement" ? "backup" : (qbs.find((x) => x.id === q)?.name ?? q)}`)
                  .join(", ")}
              </span>
            )}
            {decidedGames.length > 0 && <span>Conditioned on {decidedGames.length} played games</span>}
          </div>
        )}

        {moonResult && (
          <div className="space-y-3 rounded-xl border border-warn/30 bg-warn/[0.03] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-warn">
                🚀 Moonshots · ${moonStake} → ≥ ${(moonStake * moonMultiple).toLocaleString()}
              </span>
              <button onClick={() => setMoonResult(null)} className="text-xs text-ink-3 hover:text-down">
                ✕ close
              </button>
            </div>
            {moonResult.parlays.length === 0 && (
              <p className="text-sm text-ink-2">
                Nothing reaches {moonMultiple}x within 6 legs — try a lower multiple.
              </p>
            )}
            {moonResult.parlays.map((p, i) => (
              <div key={i}>
                <p className="tnum mb-1 font-mono text-[11px] text-warn">
                  ${moonStake} pays ${Math.round(moonStake * (p.combinedDecimal - 1)).toLocaleString()} ·
                  model says {fmtPct(p.jointProb, 1)} · that's {p.jointProb > 0 ? `1 in ${Math.round(1 / p.jointProb)}` : "—"} seasons
                </p>
                <ParlayCard
                  parlay={p}
                  rank={i + 1}
                  bankroll={moonStake}
                  anchorWeight={0}
                  copied={copied === 1000 + i}
                  added={added === 1000 + i}
                  onCopy={() => copySlip(p, 1000 + i)}
                  onAdd={() => addToPortfolio(p, 1000 + i)}
                />
              </div>
            ))}
          </div>
        )}

        {result && (
          <div className="tnum flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-4 py-2 font-mono text-[11px] text-ink-3">
            <span><b className="text-ink">{result.parlays.length}</b> parlays</span>
            <span>{result.evaluated.toLocaleString()} combos</span>
            <span>{result.poolSize} legs in pool</span>
            <span>{result.searchMs} ms</span>
            {result.truncatedPool && <span className="text-warn">pool capped — narrow markets/teams to widen</span>}
          </div>
        )}

        {loading && !result && (
          <div className="space-y-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
        )}

        {result && result.parlays.length === 0 && (
          <EmptyState>
            No parlays matched. Loosen the filters — lower Min EV or win probability, widen the
            payout window, or relax the trust filter.
          </EmptyState>
        )}

        {!result && !loading && (
          <EmptyState>
            Set your filters and hit <b className="text-ink">Find parlays</b>. The engine simulates
            the whole NFL season {sims ? `(${sims.toLocaleString()} times) ` : ""}and ranks
            combinations by correlation-adjusted probability.
          </EmptyState>
        )}

        {result?.parlays.map((p, i) => (
          <ParlayCard
            key={i}
            parlay={p}
            rank={i + 1}
            bankroll={bankroll}
            anchorWeight={anchorWeight}
            copied={copied === i}
            added={added === i}
            onCopy={() => copySlip(p, i)}
            onAdd={() => addToPortfolio(p, i)}
          />
        ))}
      </div>
    </div>
  );
}

/** Tiny bullet bar: market consensus as the bar, model estimate as the tick. */
function ProbBullet({ model, market }: { model: number; market: number }) {
  const scale = Math.max(model, market, 0.01) * 1.25;
  const w = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <span
      className="relative inline-block h-2 w-16 overflow-hidden rounded-full bg-surface-3 align-middle"
      title={`Model ${fmtPct(model, 1)} vs market ${fmtPct(market, 1)}`}
    >
      <span className="absolute inset-y-0 left-0 rounded-full bg-chart-blue/50" style={{ width: w(market) }} />
      <span
        className={`absolute inset-y-0 w-0.5 ${model >= market ? "bg-up" : "bg-warn"}`}
        style={{ left: w(model) }}
      />
    </span>
  );
}

/** American odds at which this parlay is exactly break-even for our model. */
function fairAmerican(prob: number): number {
  const p = Math.min(0.999, Math.max(0.001, prob));
  const dec = 1 / p;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}

function parseAmerican(s: string): number | null {
  const n = Number(s.replace(/[+\s]/g, ""));
  if (!Number.isFinite(n) || Math.abs(n) < 100) return null;
  return n;
}

function ParlayCard({
  parlay: p,
  rank,
  bankroll,
  anchorWeight,
  copied,
  added,
  onCopy,
  onAdd,
}: {
  parlay: Parlay;
  rank: number;
  bankroll: number;
  anchorWeight: number;
  copied: boolean;
  added: boolean;
  onCopy: () => void;
  onAdd: () => void;
}) {
  const [quote, setQuote] = useState("");
  const [logState, setLogState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const stake = bankroll * p.kellyFraction;
  const toWin = stake * (p.combinedDecimal - 1);
  const anchored = Math.abs(p.anchoredProb - p.jointProb) > 0.0005;
  const evShown = p.evAnchored;
  const evPos = evShown >= 0;
  const corr = p.correlation;
  const corrLabel = corr > 1.08 ? "correlated" : corr < 0.92 ? "anti-correlated" : null;
  const fdBeatsBest = p.bestCombinedDecimal <= p.combinedDecimal + 1e-9;
  const fair = fairAmerican(p.anchoredProb);

  // "I looked it up on FanDuel — they quote X": EV at the user's real quote.
  const quoted = parseAmerican(quote);
  const quotedDec = quoted == null ? null : quoted > 0 ? 1 + quoted / 100 : 1 + 100 / -quoted;
  const quotedEv = quotedDec == null ? null : p.anchoredProb * quotedDec - 1;

  async function logBet() {
    setLogState("saving");
    try {
      const res = await fetch("/api/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legs: p.legs.map((l) => ({
            id: l.id,
            label: l.label,
            market: l.market,
            teamId: l.teamId,
            americanOdds: l.americanOdds,
            impliedProb: l.impliedProb,
            modelProb: l.modelProb,
            marketProb: l.marketProb,
          })),
          stake: Math.max(1, Math.round(stake)),
          priceAmerican: quoted ?? p.combinedAmerican,
          jointProb: p.jointProb,
          anchoredProb: p.anchoredProb,
          anchorWeight,
        }),
      });
      setLogState(res.ok ? "done" : "error");
    } catch {
      setLogState("error");
    }
    setTimeout(() => setLogState("idle"), 2000);
  }

  return (
    <Card hover className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="tnum grid h-8 w-8 place-items-center rounded-lg bg-surface-3 font-mono text-xs font-bold text-ink-3">
            {rank}
          </span>
          <div>
            <div className="tnum font-mono text-xl font-extrabold tracking-tight">
              {fmtAmerican(p.combinedAmerican)}
            </div>
            <div className="text-[11px] text-ink-3">
              {p.legs.length}-leg · {fmtOdds(p.combinedDecimal)}
              {fdBeatsBest ? (
                <span className="ml-1.5 font-semibold text-up">FD best price ✓</span>
              ) : (
                <span className="ml-1.5 font-semibold text-warn">
                  field pays {fmtAmerican(p.bestCombinedAmerican)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-5 text-right">
          <Stat label="Win prob" value={fmtPct(p.anchoredProb)} />
          <Stat label="Fair price" value={fmtAmerican(fair)} tone="neutral" />
          <Stat
            label="EV @ board"
            value={`${evPos ? "+" : ""}${fmtPct(evShown, 1)}`}
            tone={evPos ? "good" : "bad"}
            glow
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-ink-3">
        {anchored && (
          <span className="tnum font-mono" title="Pure model, before the market anchor">
            pure model: {fmtPct(p.jointProb)} win · {p.ev >= 0 ? "+" : ""}
            {fmtPct(p.ev, 1)} EV
          </span>
        )}
        <span className="tnum font-mono">street: {fmtPct(p.marketProb)}</span>
      </div>

      <div className="mt-3 space-y-1">
        {p.legs.map((l) => {
          const fdIsBest = l.bestAmerican <= l.americanOdds;
          return (
            <div key={l.id} className="flex items-center justify-between gap-3 rounded-lg bg-bg px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{l.label}</span>
              <span className="flex shrink-0 items-center gap-3 text-xs">
                <ProbBullet model={l.modelProb} market={l.marketProb} />
                <span className="tnum w-20 text-right font-mono text-ink-3">
                  {fmtPct(l.modelProb, 0)} / {fmtPct(l.marketProb, 0)}
                </span>
                <span className="tnum w-12 text-right font-mono font-bold text-ink">
                  {fmtAmerican(l.americanOdds)}
                </span>
                {!fdIsBest && (
                  <span
                    className="font-medium text-warn"
                    title={`Best price: ${fmtAmerican(l.bestAmerican)} at ${BOOK_LABEL[l.bestBook] ?? l.bestBook}`}
                  >
                    {BOOK_LABEL[l.bestBook] ?? l.bestBook} {fmtAmerican(l.bestAmerican)}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs">
        <div className="flex flex-wrap items-center gap-3 text-ink-2">
          <span className="tnum font-mono">
            Kelly <b className="text-ink">{fmtMoney(stake)}</b> → win{" "}
            <b className="text-up">{fmtMoney(toWin)}</b>
          </span>
          {corrLabel && (
            <span
              className={`tnum rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                corr > 1.08 ? "bg-up/10 text-up" : "bg-warn/10 text-warn"
              }`}
              title={`Joint probability is ${corr.toFixed(2)}× the naive independent estimate`}
            >
              {corrLabel} {corr.toFixed(2)}×
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              FD quotes?
            </span>
            <input
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              placeholder={fmtAmerican(fair)}
              className="tnum w-16 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-ink-3/50"
              title="Type the parlay odds FanDuel actually quotes you; break-even is the placeholder"
            />
            {quotedEv != null && (
              <span className={`tnum font-mono text-xs font-bold ${quotedEv >= 0 ? "text-up" : "text-down"}`}>
                {quotedEv >= 0 ? "+" : ""}
                {fmtPct(quotedEv, 1)} {quotedEv >= 0 ? "BET" : "PASS"}
              </span>
            )}
          </span>
          <button
            onClick={logBet}
            disabled={logState === "saving"}
            className="rounded-lg border border-line px-3 py-1.5 font-semibold text-ink-2 transition-colors hover:border-warn/60 hover:text-warn disabled:opacity-50"
            title="Record this bet (model probability + price) for calibration and CLV tracking. Uses the FD quote box if filled, else the board price."
          >
            {logState === "done" ? "Logged ✓" : logState === "error" ? "Log failed" : logState === "saving" ? "Logging…" : "Log bet"}
          </button>
          <button
            onClick={onAdd}
            className="rounded-lg border border-line px-3 py-1.5 font-semibold text-ink-2 transition-colors hover:border-up-dim/60 hover:text-up"
          >
            {added ? "Added ✓" : "+ Portfolio"}
          </button>
          <button
            onClick={onCopy}
            className="rounded-lg border border-line px-3 py-1.5 font-semibold text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
          >
            {copied ? "Copied ✓" : "Copy slip"}
          </button>
        </div>
      </div>
    </Card>
  );
}
