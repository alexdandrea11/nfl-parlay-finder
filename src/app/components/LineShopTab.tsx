"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtAmerican, fmtPct } from "@/lib/format";
import {
  MARKETS,
  type Adjustment,
  type CustomBoard,
  type LegRow,
  type MarketType,
  type OddsMeta,
  type QbOverrides,
  type TeamCustomPrices,
  type TeamMeta,
} from "../clientTypes";
import type { DecidedGame } from "./FindTab";
import { BOOK_LABEL, Card, Chip, EmptyState, LiveDot, SectionTitle, Skeleton } from "./ui";

type SortKey = "ev" | "divergence" | "modelProb" | "label";

export function LineShopTab({
  teams,
  adjustments,
  decidedGames,
  qbOverrides,
  customBoard,
  setCustomBoard,
}: {
  teams: TeamMeta[];
  adjustments: Adjustment[];
  decidedGames: DecidedGame[];
  qbOverrides: QbOverrides;
  customBoard: CustomBoard;
  setCustomBoard: (b: CustomBoard) => void;
}) {
  const [legs, setLegs] = useState<LegRow[]>([]);
  const [books, setBooks] = useState<string[]>([]);
  const [oddsMeta, setOddsMeta] = useState<OddsMeta | null>(null);
  const [customLegs, setCustomLegs] = useState(0);
  const [market, setMarket] = useState<MarketType | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("ev");
  const [fdBestOnly, setFdBestOnly] = useState(false);
  const [enteredOnly, setEnteredOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/legs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adjustments, decidedGames, qbOverrides, customBoard }),
    })
      .then((r) => r.json())
      .then((d) => {
        setLegs(d.legs ?? []);
        setOddsMeta(d.oddsMeta ?? null);
        setCustomLegs(d.customLegs ?? 0);
        const bookSet = new Set<string>();
        for (const l of d.legs ?? []) for (const b of l.books) bookSet.add(b.book);
        setBooks(
          [...bookSet].sort((a, b) => (a === "fanduel" ? -1 : b === "fanduel" ? 1 : a.localeCompare(b))),
        );
      })
      .finally(() => setLoading(false));
  }, [adjustments, decidedGames, qbOverrides, customBoard]);

  const rows = useMemo(() => {
    let r = legs;
    if (market !== "all") r = r.filter((l) => l.market === market);
    if (fdBestOnly) r = r.filter((l) => l.americanOdds >= l.bestAmerican || l.bestBook === "fanduel");
    if (enteredOnly) r = r.filter((l) => l.source !== "sample");
    const sorters: Record<SortKey, (a: LegRow, b: LegRow) => number> = {
      ev: (a, b) => b.legEv - a.legEv,
      divergence: (a, b) => Math.abs(b.divergence) - Math.abs(a.divergence),
      modelProb: (a, b) => b.modelProb - a.modelProb,
      label: (a, b) => a.label.localeCompare(b.label),
    };
    return [...r].sort(sorters[sortKey]).slice(0, 120);
  }, [legs, market, sortKey, fdBestOnly, enteredOnly]);

  const boardTeamCount = Object.keys(customBoard).length;
  const hasReal = (oddsMeta?.liveLegCount ?? 0) + customLegs > 0;

  if (loading && legs.length === 0)
    return (
      <div className="space-y-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    );

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Chip active={market === "all"} onClick={() => setMarket("all")}>All markets</Chip>
        {MARKETS.map((m) => (
          <Chip key={m.key} active={market === m.key} onClick={() => setMarket(m.key)}>
            {m.label}
          </Chip>
        ))}
        <span className="mx-1.5 h-4 w-px bg-line-2" />
        <Chip active={fdBestOnly} onClick={() => setFdBestOnly(!fdBestOnly)} tone="green">
          FanDuel best-priced
        </Chip>
        {hasReal && (
          <Chip active={enteredOnly} onClick={() => setEnteredOnly(!enteredOnly)} tone="green">
            Real prices only
          </Chip>
        )}
        <span className="mx-1.5 h-4 w-px bg-line-2" />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-line bg-bg px-2.5 py-1.5 text-xs text-ink transition-colors hover:border-line-2"
        >
          <option value="ev">Sort: leg EV</option>
          <option value="divergence">Sort: model vs market gap</option>
          <option value="modelProb">Sort: model probability</option>
          <option value="label">Sort: name</option>
        </select>
        <span className="grow" />
        <button
          onClick={() => setEditing((e) => !e)}
          className={`rounded-lg border px-3.5 py-1.5 text-xs font-bold transition-colors ${
            editing
              ? "border-warn/60 bg-warn/10 text-warn"
              : "border-line text-ink-2 hover:border-line-2 hover:text-ink"
          }`}
        >
          {editing ? "Close board editor" : `✎ FanDuel board${boardTeamCount ? ` (${boardTeamCount})` : ""}`}
        </button>
      </Card>

      {editing && (
        <BoardEditor teams={teams} board={customBoard} onSave={setCustomBoard} />
      )}

      {loading && <p className="tnum font-mono text-xs text-ink-3">Re-pricing…</p>}

      {rows.length === 0 ? (
        <EmptyState>No legs match these filters.</EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="sticky top-0 bg-surface-2">
              <tr className="border-b border-line text-left text-[10px] font-bold uppercase tracking-wider text-ink-3">
                <th className="px-3.5 py-2.5">Bet</th>
                <th className="px-2.5 py-2.5 text-right">Model</th>
                <th className="px-2.5 py-2.5 text-right">Market</th>
                <th className="px-2.5 py-2.5 text-right">Edge (EV)</th>
                {books.map((b) => (
                  <th key={b} className={`px-2.5 py-2.5 text-right ${b === "fanduel" ? "text-brand" : ""}`}>
                    {BOOK_LABEL[b] ?? b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tnum font-mono text-xs">
              {rows.map((l) => {
                const evPos = l.legEv > 0;
                return (
                  <tr key={l.id} className="border-b border-line/60 transition-colors hover:bg-surface-2">
                    <td className="flex items-center gap-2 px-3.5 py-2 font-sans text-[13px] text-ink">
                      {l.source === "live" && <LiveDot />}
                      {l.source === "custom" && (
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
                          title="Your entered FanDuel price"
                        />
                      )}
                      {l.label}
                    </td>
                    <td className="px-2.5 py-2 text-right text-ink-2">{fmtPct(l.modelProb, 1)}</td>
                    <td className="px-2.5 py-2 text-right text-ink-3">{fmtPct(l.marketProb, 1)}</td>
                    <td className={`px-2.5 py-2 text-right font-bold ${evPos ? "text-up" : "text-ink-3"}`}>
                      {evPos ? "+" : ""}
                      {fmtPct(l.legEv, 1)}
                    </td>
                    {books.map((b) => {
                      const price = l.books.find((x) => x.book === b);
                      const isBest = price && l.bestBook === b && price.american === l.bestAmerican;
                      const isFd = b === "fanduel";
                      return (
                        <td
                          key={b}
                          className={`px-2.5 py-2 text-right ${
                            isBest ? "bg-up/[0.07] font-bold text-up" : isFd ? "text-brand" : "text-ink-3"
                          }`}
                        >
                          {price ? fmtAmerican(price.american) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-[11px] leading-relaxed text-ink-3">
        <span className="font-semibold text-up">Green</span> = best price across books ·{" "}
        <span className="font-semibold text-brand">blue</span> = FanDuel ·{" "}
        <span className="font-semibold text-up">●</span> live feed ·{" "}
        <span className="font-semibold text-warn">●</span> your entered price · legs without a dot
        are modeled sample prices — enter the real number in the board editor before trusting
        their EV. Showing top {rows.length} legs.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board editor: FanDuel's posted futures, typed in from the app. Draft-local
// until Apply so typing doesn't re-price on every keystroke.
// ---------------------------------------------------------------------------

type DraftBoard = Record<string, Record<string, string>>;

const COLS: { key: keyof TeamCustomPrices; label: string; placeholder: string }[] = [
  { key: "winLine", label: "Win line", placeholder: "9.5" },
  { key: "winOver", label: "Over", placeholder: "-110" },
  { key: "winUnder", label: "Under", placeholder: "-110" },
  { key: "playoffsYes", label: "Playoffs", placeholder: "+120" },
  { key: "division", label: "Division", placeholder: "+250" },
  { key: "conference", label: "Conf", placeholder: "+700" },
  { key: "superbowl", label: "SB", placeholder: "+1500" },
];

function toDraft(board: CustomBoard): DraftBoard {
  const d: DraftBoard = {};
  for (const [t, p] of Object.entries(board)) {
    d[t] = {};
    for (const c of COLS) {
      const v = p[c.key];
      if (v != null) d[t][c.key] = c.key === "winLine" ? String(v) : v > 0 ? `+${v}` : String(v);
    }
  }
  return d;
}

function fromDraft(draft: DraftBoard): CustomBoard {
  const board: CustomBoard = {};
  for (const [t, row] of Object.entries(draft)) {
    const entry: TeamCustomPrices = {};
    for (const c of COLS) {
      const raw = (row[c.key] ?? "").trim().replace(/^\+/, "");
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      if (c.key === "winLine") {
        if (n >= 0.5 && n <= 16.5) entry.winLine = Math.round(n * 2) / 2;
      } else if (Math.abs(n) >= 100) {
        entry[c.key] = Math.round(n);
      }
    }
    if (Object.keys(entry).length > 0) board[t] = entry;
  }
  return board;
}

function BoardEditor({
  teams,
  board,
  onSave,
}: {
  teams: TeamMeta[];
  board: CustomBoard;
  onSave: (b: CustomBoard) => void;
}) {
  const [draft, setDraft] = useState<DraftBoard>(() => toDraft(board));
  const [savedFlash, setSavedFlash] = useState(false);

  function setCell(teamId: string, key: string, value: string) {
    setDraft((d) => ({ ...d, [teamId]: { ...(d[teamId] ?? {}), [key]: value } }));
  }

  function apply() {
    onSave(fromDraft(draft));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  const filled = Object.values(fromDraft(draft)).reduce(
    (a, p) => a + Object.keys(p).filter((k) => k !== "winLine").length,
    0,
  );

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>FanDuel price board — type in what the app shows</SectionTitle>
        <div className="flex items-center gap-2">
          <span className="tnum font-mono text-[11px] text-ink-3">{filled} prices entered</span>
          <button
            onClick={() => setDraft({})}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 transition-colors hover:border-down/50 hover:text-down"
          >
            Clear
          </button>
          <button
            onClick={apply}
            className="rounded-lg bg-up px-4 py-1.5 text-xs font-bold text-[#03271c] transition hover:bg-up-dim"
          >
            {savedFlash ? "Applied ✓" : "Apply board"}
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        Enter any subset — every price you type replaces the modeled sample for that leg and is
        marked <span className="font-semibold text-warn">●</span> everywhere. Win line accepts
        FanDuel's posted total (e.g. 9.5); prices accept American odds (+120, -110). Futures move
        slowly — refreshing this weekly is plenty.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-ink-3">
              <th className="py-1.5 pr-2">Team</th>
              {COLS.map((c) => (
                <th key={c.key} className="px-1 py-1.5">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id} className="border-t border-line/60">
                <td className="tnum py-1 pr-2 font-mono text-xs font-bold text-ink-2" title={t.name}>
                  {t.id}
                </td>
                {COLS.map((c) => (
                  <td key={c.key} className="px-1 py-1">
                    <input
                      value={draft[t.id]?.[c.key] ?? ""}
                      onChange={(e) => setCell(t.id, c.key, e.target.value)}
                      placeholder={c.placeholder}
                      className="tnum w-full min-w-14 rounded-md border border-line bg-bg px-1.5 py-1 font-mono text-[11px] text-ink placeholder:text-ink-3/40 transition-colors hover:border-line-2"
                      inputMode="numeric"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
