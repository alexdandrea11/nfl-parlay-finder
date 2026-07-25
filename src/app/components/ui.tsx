"use client";

// Shared UI primitives — sharp fintech/sportsbook dark theme.

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        {label}
      </label>
      {children}
    </div>
  );
}

export function NumInput({
  value,
  min,
  max,
  onChange,
  wide,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  wide?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`tnum rounded-lg border border-line bg-bg px-2.5 py-1.5 font-mono text-sm text-ink transition-colors hover:border-line-2 ${wide ? "w-full" : "w-[4.5rem]"}`}
    />
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-3 transition-colors hover:border-line-2 ${props.className ?? ""}`}
    />
  );
}

export function Chip({
  active,
  onClick,
  children,
  tone = "blue",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "blue" | "green";
}) {
  const activeCls =
    tone === "green"
      ? "border-up-dim/60 bg-up/10 text-up"
      : "border-brand/50 bg-brand/10 text-brand";
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        active ? activeCls : "border-line text-ink-2 hover:border-line-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function Toggle({
  on,
  onChange,
  labelOn,
  labelOff,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
        on ? "border-up-dim/60 bg-up/10 text-up" : "border-line text-ink-2 hover:border-line-2"
      }`}
    >
      <span>{on ? labelOn : labelOff}</span>
      <span
        className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ${on ? "bg-up-dim" : "bg-line-2"}`}
      >
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full bg-bg transition-transform ${on ? "translate-x-3" : "translate-x-0.5"}`}
        />
      </span>
    </button>
  );
}

export function Stat({
  label,
  value,
  tone = "neutral",
  size = "base",
  glow = false,
}: {
  label: string;
  value: string;
  tone?: string;
  size?: "base" | "lg" | "xl";
  glow?: boolean;
}) {
  const color =
    tone === "good"
      ? "text-up"
      : tone === "bad"
        ? "text-down"
        : tone === "warn"
          ? "text-warn"
          : tone === "muted"
            ? "text-ink-2"
            : "text-ink";
  const sizeCls = size === "xl" ? "text-2xl" : size === "lg" ? "text-xl" : "text-base";
  return (
    <div>
      <div
        className={`tnum font-mono font-bold leading-tight ${color} ${sizeCls} ${glow && tone === "good" ? "glow-up" : ""}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-3">
        {label}
      </div>
    </div>
  );
}

export function Card({
  children,
  className = "",
  hover = false,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface ${hover ? "card-hover" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">{children}</h2>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-2 bg-surface/40 p-10 text-center text-sm leading-relaxed text-ink-2">
      {children}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function LiveDot({ title = "Live price" }: { title?: string }) {
  return (
    <span
      className="live-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-up"
      title={title}
    />
  );
}

export const BOOK_LABEL: Record<string, string> = {
  fanduel: "FanDuel",
  draftkings: "DraftKings",
  betmgm: "BetMGM",
  caesars: "Caesars",
  espnbet: "ESPN BET",
  betonlineag: "BetOnline",
  betrivers: "BetRivers",
  bovada: "Bovada",
  mybookieag: "MyBookie",
  betus: "BetUS",
  lowvig: "LowVig",
  ballybet: "Bally Bet",
};
