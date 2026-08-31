import { formatCents, type Cents } from "@pcs/shared";

/** Money, always from integer cents. Never build a price from a float. */
export const money = (c: Cents) => formatCents(c);

/** Compact money for dense tiles: $12.4k. Still fed by integer cents. */
export function moneyCompact(c: Cents): string {
  const dollars = c / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (Math.abs(dollars) >= 10_000) return `$${(dollars / 1000).toFixed(1)}k`;
  return formatCents(c);
}

export function signedPct(n: number): string {
  const s = n >= 0 ? "+" : "−";
  return `${s}${Math.abs(n).toFixed(1)}%`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** Certification-style serial, the way a slab label prints one. */
export function certNumber(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return String(Math.abs(h) % 100000000).padStart(8, "0");
}
