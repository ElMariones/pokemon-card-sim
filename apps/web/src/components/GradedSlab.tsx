"use client";

import { cn } from "@/lib/cn";

/**
 * A graded card in its slab.
 *
 * The three companies are visually distinct in the real hobby and collectors
 * read them at a glance, so the label is drawn per company rather than
 * recoloured from one template: PSA's red banner, Beckett's black-and-silver
 * (gold for a Black Label), CGC's blue. Nothing here reproduces a company's
 * logo artwork — it is their layout and colour, drawn in CSS.
 *
 * The slab wraps the card rather than replacing it, so every card treatment
 * (foil, tilt, flip) still applies to the card inside the plastic.
 */

export type SlabCompany = "PSA" | "BGS" | "CGC";

export interface SlabGrade {
  company: string;
  numericGrade: number | null;
  label?: string | null;
  isBlackLabel?: boolean;
}

const THEME: Record<SlabCompany, {
  bar: string;
  text: string;
  accent: string;
  wordmark: string;
}> = {
  PSA: {
    bar: "linear-gradient(180deg,#f4f2ee 0%,#e8e4dc 100%)",
    text: "#1a1a1a",
    accent: "#c8102e",
    wordmark: "PSA",
  },
  BGS: {
    bar: "linear-gradient(180deg,#1c1c1f 0%,#0e0e10 100%)",
    text: "#f0ede6",
    accent: "#c9a227",
    wordmark: "BECKETT",
  },
  CGC: {
    bar: "linear-gradient(180deg,#f6f7f9 0%,#e6eaf0 100%)",
    text: "#10233f",
    accent: "#0b5cab",
    wordmark: "CGC",
  },
};

const isCompany = (v: string): v is SlabCompany => v === "PSA" || v === "BGS" || v === "CGC";

/** Deterministic per inventory item, so a slab keeps its number across renders. */
function certNumber(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return String((h >>> 0) % 90_000_000 + 10_000_000);
}

export function GradedSlab({
  grade,
  cardName,
  setName,
  certSeed,
  children,
  className,
  compact,
}: {
  grade: SlabGrade;
  cardName: string;
  setName?: string;
  certSeed: string;
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const company = isCompany(grade.company) ? grade.company : "PSA";
  const theme = THEME[company];
  const black = Boolean(grade.isBlackLabel);

  const gradeText = grade.numericGrade === null ? "—" : String(grade.numericGrade);
  const gem = grade.numericGrade === 10;

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-[10px]",
        // The plastic: a cool rim, a soft inner glow, and a highlight edge.
        "bg-gradient-to-b from-[#dfe4ec]/18 to-[#8e97a8]/10",
        "ring-1 ring-white/22 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.75)]",
        className,
      )}
      // The whole slab is announced once; the card inside is decorative here.
      role="group"
      aria-label={
        `${company} ${gradeText}${grade.label ? ` ${grade.label}` : ""} slab: ` +
        `${cardName}${setName ? `, ${setName}` : ""}`
      }
    >
      {/* Label */}
      <div
        className={cn(
          "relative flex items-stretch gap-1.5 border-b border-black/25",
          compact ? "px-1.5 py-1" : "px-2.5 py-1.5",
        )}
        style={{ background: black ? "linear-gradient(180deg,#0a0a0b,#000)" : theme.bar }}
      >
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <span
            className={cn(
              "t-display leading-none tracking-[0.14em]",
              compact ? "text-[7px]" : "text-[9px]",
            )}
            style={{ color: black ? "#c9a227" : theme.accent }}
          >
            {black ? "BLACK LABEL" : theme.wordmark}
          </span>
          {!compact && (
            <>
              <span
                className="mt-0.5 truncate text-[9px] leading-tight font-semibold"
                style={{ color: black ? "#f0ede6" : theme.text }}
              >
                {cardName}
              </span>
              <span
                className="t-mono truncate text-[7px] leading-tight opacity-70"
                style={{ color: black ? "#f0ede6" : theme.text }}
              >
                {setName} · {certNumber(certSeed)}
              </span>
            </>
          )}
        </div>

        <div
          className={cn(
            "flex shrink-0 flex-col items-center justify-center rounded-[3px] px-1.5",
            compact ? "min-w-[22px]" : "min-w-[34px]",
          )}
          style={{
            background: black ? "#c9a227" : gem ? theme.accent : "transparent",
            color: black ? "#0a0a0b" : gem ? "#fff" : theme.text,
          }}
        >
          {!compact && (
            <span className="t-mono text-[6px] leading-none tracking-widest opacity-70">
              {gem ? "GEM MT" : "GRADE"}
            </span>
          )}
          <span
            className={cn("t-display leading-none tabular-nums", compact ? "text-[11px]" : "text-base")}
          >
            {gradeText}
          </span>
        </div>
      </div>

      {/* The card itself, inset the way it sits inside a real holder. */}
      <div className={cn("relative", compact ? "p-1" : "p-2")}>
        <div className="overflow-hidden rounded-[4px]">{children}</div>
      </div>

      {/* Plastic sheen. Purely decorative and never intercepts pointer events,
          so the card underneath keeps its tilt and flip interactions. */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "linear-gradient(114deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.03) 22%," +
            " transparent 42%, transparent 62%, rgba(255,255,255,0.07) 84%, rgba(255,255,255,0.02) 100%)",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 z-10 rounded-[10px] ring-1 ring-inset ring-white/10"
        aria-hidden
      />
    </div>
  );
}
