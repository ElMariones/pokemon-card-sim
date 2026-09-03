"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Cents } from "@pcs/shared";

/**
 * One machine on the floor.
 *
 * The screen is a real preview — the sprite the player actually flies, the
 * back they actually flip — rather than an icon, because what the arcade sells
 * is exactly that: how the game looks while you play it.
 */

export interface ArcadeCabinetProps {
  href: string;
  name: string;
  /** What the machine asks of you, in one line. */
  tagline: string;
  /** How the score is earned, so the payout is not a mystery. */
  scoring: string;
  best: number;
  bestLabel: string;
  earnedToday: Cents;
  /** The equipped cosmetic's two colours; the machine is lit by them. */
  palette: readonly [string, string];
  screen: ReactNode;
  spent: boolean;
}

export function ArcadeCabinet({
  href, name, tagline, scoring, best, bestLabel, earnedToday, palette, screen, spent,
}: ArcadeCabinetProps) {
  return (
    <Link
      href={href}
      scroll={false}
      className="cabinet group"
      style={{ ["--cab" as string]: palette[0], ["--cab-deep" as string]: palette[1] }}
    >
      <div className="cabinet__marquee">
        <h2 className="t-display text-manila text-base leading-none tracking-tight">{name}</h2>
        <p className="text-manila-3 mt-1.5 text-xs leading-snug">{tagline}</p>
      </div>

      <div className="cabinet__screen">{screen}</div>

      <div className="border-seam/70 flex items-center gap-4 border-t px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="t-eyebrow leading-none">{bestLabel}</p>
          <p className="t-num text-manila mt-1 text-lg leading-none tabular-nums">
            {best > 0 ? best.toLocaleString() : "—"}
          </p>
        </div>

        <div className="text-right">
          <p className="t-eyebrow leading-none">Today</p>
          <p
            className={cn(
              "t-num mt-1 text-lg leading-none tabular-nums",
              earnedToday > 0 ? "text-brass" : "text-manila-3",
            )}
          >
            {money(earnedToday)}
          </p>
        </div>
      </div>

      <p className="text-manila-3 border-seam/70 border-t px-4 py-2.5 text-[11px] leading-snug">
        {spent ? "Allowance spent — runs still count for your best." : scoring}
      </p>
    </Link>
  );
}
