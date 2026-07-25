export function fmtAmerican(a: number): string {
  return a > 0 ? `+${a}` : `${a}`;
}

export function fmtPct(p: number, digits = 1): string {
  return `${(p * 100).toFixed(digits)}%`;
}

export function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
}

export function fmtOdds(decimal: number): string {
  return `${decimal.toFixed(2)}x`;
}
