"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Cents } from "@pcs/shared";
import type { RunResult, RunStatus } from "./useMinigameRun";

/**
 * The furniture around a game: how you start it, what it says while you play,
 * and what it pays when you stop.
 *
 * All three games need exactly this, and none of them should be re-deciding
 * how a payout is worded — a player who has learned to read one result screen
 * has learned to read all three.
 */

export interface GameFrameProps {
  name: string;
  /** The rule, in one line. Shown before the first run and never again. */
  rule: string;
  status: RunStatus;
  error: string | null;
  result: RunResult | null;
  palette: readonly [string, string];
  onStart: () => void | Promise<void>;
  onAgain: () => void;
  startLabel: string;
  stats?: { label: string; value: string }[];
  children: ReactNode;
}

export function GameFrame({
  name, rule, status, error, result, palette, onStart, onAgain, startLabel, stats = [], children,
}: GameFrameProps) {
  return (
    <div
      className="mx-auto max-w-4xl px-5 py-8"
      style={{ ["--cab" as string]: palette[0], ["--cab-deep" as string]: palette[1] }}
    >
      <Link
        href="/games"
        scroll={false}
        className="text-manila-2 hover:text-manila mb-6 inline-flex items-center gap-2 text-sm transition"
      >
        <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.8} />
        Back to the arcade
      </Link>

      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-display text-2xl leading-none tracking-tight">{name}</h1>
          <p className="text-manila-3 mt-2 max-w-lg text-xs">{rule}</p>
        </div>

        {stats.length > 0 && (
          <dl className="flex gap-6" aria-live="polite">
            {stats.map((s) => (
              <div key={s.label} className="text-right">
                <dt className="t-eyebrow leading-none">{s.label}</dt>
                <dd className="t-num text-manila mt-1.5 text-lg leading-none tabular-nums">
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      {error && (
        <p role="alert" className="text-loss ring-loss/40 mb-5 rounded-pane px-4 py-3 text-sm ring-1">
          {error}
        </p>
      )}

      {status === "idle" && (
        <div className="pane grid place-items-center px-6 py-16 text-center">
          <button
            type="button"
            onClick={() => void onStart()}
            className="bg-brass-dim text-manila hover:bg-brass hover:text-ink rounded-pane px-6 py-3 text-sm transition"
          >
            {startLabel}
          </button>
        </div>
      )}

      {status === "starting" && (
        <p className="text-manila-3 pane px-6 py-16 text-center text-sm">Setting up…</p>
      )}

      {(status === "playing" || status === "settling") && children}

      {status === "done" && result && (
        <div className="pane px-6 py-10 text-center">
          <p className="t-eyebrow leading-none">You scored</p>
          <p className="t-num text-manila mt-2 text-4xl leading-none tabular-nums">
            {result.score.toLocaleString()}
          </p>

          <p
            className={cn(
              "t-num mt-6 text-2xl leading-none tabular-nums",
              result.payout > 0 ? "text-brass" : "text-manila-3",
            )}
          >
            {result.payout > 0 ? `+${money(result.payout)}` : "No payout"}
          </p>

          <p className="text-manila-3 mx-auto mt-3 max-w-sm text-xs leading-relaxed">
            {result.payout === 0
              ? "Today's allowance is spent. Scores still count towards your best — the arcade just stops paying until midnight UTC."
              : result.capped
                ? "That is the last of today's allowance. The run was worth more, but the cap is the cap."
                : `${money(result.capRemaining as Cents)} of today's allowance left.`}
          </p>

          {result.score >= result.best && result.score > 0 && (
            <p className="text-manila-2 mt-4 text-xs">A new best.</p>
          )}

          <button
            type="button"
            onClick={onAgain}
            className="ring-seam text-manila hover:bg-vitrine-3 mt-8 rounded-pane px-5 py-2.5 text-sm ring-1 transition"
          >
            Play again
          </button>
        </div>
      )}
    </div>
  );
}
