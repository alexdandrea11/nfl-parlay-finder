"use client";

import { useEffect, useState } from "react";
import {
  loadLS,
  saveLS,
  type Adjustment,
  type CustomBoard,
  type OddsMeta,
  type QbInfo,
  type QbOverrides,
  type SavedTicket,
  type ScheduledGame,
  type TeamMeta,
} from "./clientTypes";
import { BuilderTab } from "./components/BuilderTab";
import { FantasyTab } from "./components/FantasyTab";
import { FindTab, type DecidedGame } from "./components/FindTab";
import { GameLinesTab } from "./components/GameLinesTab";
import { GauntletTab } from "./components/GauntletTab";
import { GuideTab } from "./components/GuideTab";
import { InsightsTab } from "./components/InsightsTab";
import { ScenarioTab } from "./components/ScenarioTab";
import { LineShopTab } from "./components/LineShopTab";
import { ModelTab } from "./components/ModelTab";
import { PortfolioTab } from "./components/PortfolioTab";
import { StreetTab } from "./components/StreetTab";
import { TeamsTab } from "./components/TeamsTab";
import { WeeklyTab } from "./components/WeeklyTab";
import { LiveDot } from "./components/ui";

type Tab =
  | "find" | "builder" | "games" | "weekly" | "fantasy" | "gauntlet" | "teams" | "scenarios" | "insights" | "street" | "lines" | "portfolio" | "model" | "guide";

const TABS: { key: Tab; label: string }[] = [
  { key: "find", label: "Find Parlays" },
  { key: "builder", label: "Builder" },
  { key: "games", label: "Game Lines" },
  { key: "weekly", label: "Weekly Bets" },
  { key: "fantasy", label: "Fantasy" },
  { key: "gauntlet", label: "Gauntlet" },
  { key: "teams", label: "Teams" },
  { key: "scenarios", label: "Scenarios" },
  { key: "insights", label: "Insights" },
  { key: "street", label: "Vs. Street" },
  { key: "lines", label: "Line Shop" },
  { key: "portfolio", label: "Portfolio" },
  { key: "model", label: "Model Trust" },
  { key: "guide", label: "Guide" },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("find");
  const [teams, setTeams] = useState<TeamMeta[]>([]);
  const [sims, setSims] = useState(0);
  const [oddsMeta, setOddsMeta] = useState<OddsMeta | null>(null);

  // Shared model state — applies across Find, Portfolio, and alerts.
  const [adjustments, setAdjustmentsRaw] = useState<Adjustment[]>(() =>
    loadLS("nfl-adjustments", []),
  );
  const [decidedGames, setDecidedGamesRaw] = useState<DecidedGame[]>(() =>
    loadLS("nfl-decided-games", []),
  );
  const [tickets, setTicketsRaw] = useState<SavedTicket[]>(() => loadLS("nfl-tickets", []));
  const [qbOverrides, setQbOverridesRaw] = useState<QbOverrides>(() =>
    loadLS("nfl-qb-overrides", {}),
  );
  const [qbs, setQbs] = useState<QbInfo[]>([]);
  const [qbStarters, setQbStarters] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState<ScheduledGame[]>([]);
  const [customBoard, setCustomBoardRaw] = useState<CustomBoard>(() =>
    loadLS("nfl-price-board", {}),
  );
  const [autoSync, setAutoSyncRaw] = useState<boolean>(() => loadLS("nfl-auto-sync", true));
  const [freshness, setFreshness] = useState<{
    seasonStatsWeek: number | null;
    seasonStatsFetchedAt: number | null;
  } | null>(null);
  const [modelBuiltAt, setModelBuiltAt] = useState<string | null>(null);

  const setAdjustments = (a: Adjustment[]) => {
    setAdjustmentsRaw(a);
    saveLS("nfl-adjustments", a);
  };
  const setDecidedGames = (g: DecidedGame[]) => {
    setDecidedGamesRaw(g);
    saveLS("nfl-decided-games", g);
  };
  const setTickets = (t: SavedTicket[]) => {
    setTicketsRaw(t);
    saveLS("nfl-tickets", t);
  };
  const setQbOverrides = (q: QbOverrides) => {
    setQbOverridesRaw(q);
    saveLS("nfl-qb-overrides", q);
  };
  const setCustomBoard = (b: CustomBoard) => {
    setCustomBoardRaw(b);
    saveLS("nfl-price-board", b);
  };
  const setAutoSync = (v: boolean) => {
    setAutoSyncRaw(v);
    saveLS("nfl-auto-sync", v);
  };

  useEffect(() => {
    fetch("/api/meta")
      .then((r) => r.json())
      .then((d) => {
        setTeams(d.teams ?? []);
        setSims(d.sims ?? 0);
        setOddsMeta(d.oddsMeta ?? null);
        setQbs(d.qbs ?? []);
        setQbStarters(d.qbStarters ?? {});
        setSchedule(d.schedule ?? []);
        setFreshness(d.freshness ?? null);
        setModelBuiltAt(d.modelMeta?.generatedAt ?? null);
      })
      .catch(() => {});
  }, []);

  // Cross-device sync: all app state (board, tickets, QB swaps, adjustments,
  // saved searches) mirrors to a cloud doc. On load, a newer remote copy
  // replaces localStorage and reloads once; afterwards local changes push up
  // every 20s when something actually changed. Last write wins.
  useEffect(() => {
    const KEYS = [
      "nfl-price-board",
      "nfl-tickets",
      "nfl-qb-overrides",
      "nfl-adjustments",
      "nfl-decided-games",
      "nfl-saved-searches",
      "nfl-auto-sync",
    ];
    const serialize = () => {
      const kv: Record<string, unknown> = {};
      for (const k of KEYS) {
        const raw = localStorage.getItem(k);
        if (raw != null) {
          try {
            kv[k] = JSON.parse(raw);
          } catch {
            /* skip */
          }
        }
      }
      return kv;
    };
    let lastPushed = "";
    let timer: ReturnType<typeof setInterval> | null = null;

    fetch("/api/state")
      .then((r) => r.json())
      .then((remote: { kv?: Record<string, unknown>; updatedAt?: number }) => {
        const localTs = Number(localStorage.getItem("nfl-sync-ts") ?? 0);
        if (remote?.updatedAt && remote.updatedAt > localTs && remote.kv) {
          for (const [k, v] of Object.entries(remote.kv)) {
            if (KEYS.includes(k)) localStorage.setItem(k, JSON.stringify(v));
          }
          localStorage.setItem("nfl-sync-ts", String(remote.updatedAt));
          window.location.reload();
          return;
        }
        lastPushed = JSON.stringify(serialize());
        timer = setInterval(async () => {
          const now = JSON.stringify(serialize());
          if (now === lastPushed) return;
          try {
            const res = await fetch("/api/state", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kv: JSON.parse(now) }),
            });
            const d = await res.json();
            if (d?.updatedAt) {
              localStorage.setItem("nfl-sync-ts", String(d.updatedAt));
              lastPushed = now;
            }
          } catch {
            /* retry next tick */
          }
        }, 20000);
      })
      .catch(() => {});
    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);

  // Auto-sync real results on load: played games override manual entries for
  // the same matchup; manual entries for unplayed games are kept.
  useEffect(() => {
    if (!autoSync) return;
    fetch("/api/season-sync")
      .then((r) => r.json())
      .then((d) => {
        const synced: DecidedGame[] = d.decidedGames ?? [];
        if (synced.length === 0) return;
        setDecidedGamesRaw((prev) => {
          const key = (g: DecidedGame) => `${g.homeId}|${g.awayId}`;
          const syncedKeys = new Set(synced.map(key));
          const merged = [...synced, ...prev.filter((g) => !syncedKeys.has(key(g)))];
          saveLS("nfl-decided-games", merged);
          return merged;
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync]);

  const isLive = oddsMeta?.source === "live";
  const fetchedAgo =
    oddsMeta?.fetchedAt != null
      ? Math.max(0, Math.round((Date.now() - oddsMeta.fetchedAt) / 60000))
      : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto max-w-[1440px] px-5 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* Brand mark */}
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand/30 to-up/20 font-mono text-base font-black text-up">
                P/E
              </div>
              <div>
                <h1 className="text-lg font-extrabold leading-tight tracking-tight">
                  ParlayEdge
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.2em] text-ink-3">
                    NFL Futures
                  </span>
                </h1>
                <p className="text-xs text-ink-2">
                  {sims ? `${sims.toLocaleString()} simulated seasons` : "warming up…"} ·
                  unit-matchup model (2023–25 EPA) · real 2026 schedule
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isLive ? (
                <span className="flex items-center gap-1.5 rounded-full border border-up-dim/40 bg-up/10 px-3 py-1 text-[11px] font-bold text-up">
                  <LiveDot />
                  LIVE ODDS
                  <span className="font-medium text-up-dim">
                    · Super Bowl mkt{fetchedAgo != null && ` · ${fetchedAgo}m ago`}
                  </span>
                </span>
              ) : (
                <span className="rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-[11px] font-bold text-brand">
                  SAMPLE ODDS
                </span>
              )}
              <span className="rounded-full border border-warn/30 bg-warn/5 px-3 py-1 text-[11px] font-medium text-warn">
                Analysis only · 21+
              </span>
            </div>
          </div>

          <nav
            className="mt-3 flex gap-0.5 overflow-x-auto whitespace-nowrap"
            style={{ scrollbarWidth: "none" }}
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative rounded-t-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                  tab === t.key ? "text-ink" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {t.label}
                {t.key === "portfolio" && tickets.length > 0 && (
                  <span className="tnum ml-1.5 rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
                    {tickets.length}
                  </span>
                )}
                {tab === t.key && (
                  <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-up" />
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] p-5">
        {tab === "find" && (
          <FindTab
            teams={teams}
            sims={sims}
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            decidedGames={decidedGames}
            setDecidedGames={setDecidedGames}
            qbOverrides={qbOverrides}
            qbs={qbs}
            schedule={schedule}
            customBoard={customBoard}
            autoSync={autoSync}
            setAutoSync={setAutoSync}
            onAddTicket={(t) => setTickets([...tickets, t])}
          />
        )}
        {tab === "teams" && (
          <TeamsTab
            teams={teams}
            adjustments={adjustments}
            decidedGames={decidedGames}
            qbs={qbs}
            qbStarters={qbStarters}
            qbOverrides={qbOverrides}
            setQbOverrides={setQbOverrides}
          />
        )}
        {tab === "builder" && (
          <BuilderTab
            teams={teams}
            adjustments={adjustments}
            decidedGames={decidedGames}
            qbOverrides={qbOverrides}
            customBoard={customBoard}
            onAddTickets={(t) => setTickets([...tickets, ...t])}
          />
        )}
        {tab === "weekly" && (
          <WeeklyTab adjustments={adjustments} decidedGames={decidedGames} qbOverrides={qbOverrides} />
        )}
        {tab === "fantasy" && (
          <FantasyTab adjustments={adjustments} decidedGames={decidedGames} qbOverrides={qbOverrides} />
        )}
        {tab === "gauntlet" && (
          <GauntletTab adjustments={adjustments} decidedGames={decidedGames} qbOverrides={qbOverrides} />
        )}
        {tab === "games" && (
          <GameLinesTab
            adjustments={adjustments}
            decidedGames={decidedGames}
            qbOverrides={qbOverrides}
          />
        )}
        {tab === "scenarios" && (
          <ScenarioTab
            schedule={schedule}
            adjustments={adjustments}
            decidedGames={decidedGames}
            qbOverrides={qbOverrides}
          />
        )}
        {tab === "insights" && (
          <InsightsTab
            adjustments={adjustments}
            decidedGames={decidedGames}
            qbOverrides={qbOverrides}
            customBoard={customBoard}
          />
        )}
        {tab === "street" && (
          <StreetTab
            adjustments={adjustments}
            decidedGames={decidedGames}
            qbOverrides={qbOverrides}
            customBoard={customBoard}
          />
        )}
        {tab === "guide" && <GuideTab />}
        {tab === "lines" && (
          <LineShopTab
            teams={teams}
            adjustments={adjustments}
            decidedGames={decidedGames}
            qbOverrides={qbOverrides}
            customBoard={customBoard}
            setCustomBoard={setCustomBoard}
          />
        )}
        {tab === "portfolio" && (
          <PortfolioTab
            tickets={tickets}
            setTickets={setTickets}
            adjustments={adjustments}
            decidedGames={decidedGames}
            qbOverrides={qbOverrides}
            customBoard={customBoard}
          />
        )}
        {tab === "model" && <ModelTab />}
      </main>

      <footer className="mx-auto max-w-[1440px] px-5 pb-10 pt-2 text-[11px] leading-relaxed text-ink-3">
        <span className="tnum font-mono">
          Data: priors 2023–25{modelBuiltAt && ` (built ${modelBuiltAt.slice(0, 10)})`} ·{" "}
          {freshness?.seasonStatsWeek
            ? `in-season stats through wk ${freshness.seasonStatsWeek} (auto-refreshes)`
            : "preseason — in-season stats will blend in automatically"}{" "}
          · experts refresh 12h · odds 6h{autoSync ? " · results auto-sync on" : ""}
        </span>
        <br />
        {isLive
          ? "Super Bowl prices are live from your odds feed; other futures markets use modeled sample prices until the feed covers them. "
          : "Running on seeded sample odds and model ratings — not live FanDuel prices. "}
        Not betting advice. Positive expected value does not mean a bet is likely to win; parlays
        are high-variance by design. 21+. If gambling stops being fun, call 1-800-GAMBLER.
      </footer>
    </div>
  );
}
