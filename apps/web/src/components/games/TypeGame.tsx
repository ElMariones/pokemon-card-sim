"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useMinigameRun } from "./useMinigameRun";
import { TypeBackdrop } from "./CosmeticArt";
import { GameFrame } from "./GameFrame";

/**
 * Speed Type.
 *
 * The passage is built from card names, set names and hobby vocabulary, so it
 * reads as something from inside the game rather than as filler, and it is
 * typed over whichever Pokémon the player has equipped — held well under half
 * opacity, because this is the one game where the decoration sits directly
 * behind the thing being read.
 *
 * This is the game the server can check exactly. It generated the same passage
 * from the same seed, so a claim of more correct characters than the passage
 * contains is refuted by arithmetic rather than by a heuristic.
 *
 * The timer starts on the first keystroke, not on load. Counting reading time
 * against the player's speed would understate every score and make the WPM
 * readout a lie.
 */

export function TypeGame() {
  const { status, run, result, error, start, settle, reset } = useMinigameRun("type");

  const [typed, setTyped] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const passage = run?.content.kind === "type" ? run.content.passage : "";
  const palette = run?.equipped.palette ?? ["#5f7fa6", "#2d3d55"];

  const correctChars = countCorrect(passage, typed);
  const elapsedSec = startedAt ? Math.max(0.001, (now - startedAt) / 1000) : 0;
  const wpm = elapsedSec > 0 ? Math.round(correctChars / 5 / (elapsedSec / 60)) : 0;
  const accuracy = typed.length > 0 ? Math.round((correctChars / typed.length) * 100) : 100;

  // A ticking clock for the live WPM readout. Only runs while typing.
  useEffect(() => {
    if (startedAt === null || status !== "playing") return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [startedAt, status]);

  useEffect(() => {
    if (status === "playing") inputRef.current?.focus();
  }, [status]);

  /**
   * Stop, whether by Escape or by the button.
   *
   * Guarded on status because finishing the passage already settles the run:
   * without this, hitting Stop on the result screen would post the same token
   * a second time and greet the player with "that run has already been
   * settled" over the payout they just earned.
   */
  const finish = useCallback(() => {
    if (status !== "playing") return;
    void settle(countCorrect(passage, typed));
  }, [status, settle, passage, typed]);

  const begin = useCallback(async () => {
    setTyped("");
    setStartedAt(null);
    await start();
  }, [start]);

  const onChange = (value: string) => {
    if (status !== "playing") return;
    if (value.length > passage.length) return;

    if (startedAt === null && value.length > 0) {
      const t = performance.now();
      setStartedAt(t);
      setNow(t);
    }

    setTyped(value);

    if (value.length === passage.length) {
      void settle(countCorrect(passage, value));
    }
  };

  return (
    <GameFrame
      name="Speed Type"
      rule="Type the passage. Only correct characters pay — a typo you leave in is a character you did not earn."
      status={status}
      error={error}
      result={result}
      palette={palette}
      onStart={begin}
      onAgain={() => { reset(); void begin(); }}
      startLabel="Start typing"
      stats={
        status === "playing"
          ? [
              { label: "WPM", value: String(wpm) },
              { label: "Accuracy", value: `${accuracy}%` },
              { label: "Correct", value: String(correctChars) },
            ]
          : []
      }
    >
      {run && (
        <div
          className="pane type-surface p-6"
          onClick={() => inputRef.current?.focus()}
          style={{
            ["--cab" as string]: palette[0],
            ["--cab-deep" as string]: palette[1],
          }}
        >
          <TypeBackdrop cosmetic={run.equipped} />

          <p className="type-passage" aria-label="Passage to type">
            {passage.split("").map((char, i) => {
              const state =
                i >= typed.length
                  ? i === typed.length
                    ? "current"
                    : "pending"
                  : typed[i] === char
                    ? "correct"
                    : "wrong";

              return (
                <span key={i} className={cn(`type-char--${state}`)}>
                  {/* A mistyped space needs to be visible, or the player
                      cannot see what went wrong. */}
                  {char === " " && state === "wrong" ? "␣" : char}
                </span>
              );
            })}
          </p>

          {/* The real input is hidden but focusable, so mobile keyboards open
              and the visible passage stays the interface. */}
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                finish();
              }
            }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Type here"
            className="absolute h-px w-px opacity-0"
          />

          <div className="border-seam/70 mt-6 flex items-center justify-between gap-4 border-t pt-4">
            <p className="text-manila-3 text-xs">
              {startedAt === null ? "Start typing whenever you are ready." : "Escape to stop early."}
            </p>
            <button
              type="button"
              onClick={finish}
              className="ring-seam text-manila-2 hover:text-manila hover:bg-vitrine-3 rounded-pane px-3 py-1.5 text-xs ring-1 transition"
            >
              Stop
            </button>
          </div>
        </div>
      )}
    </GameFrame>
  );
}

/** Correct characters are counted by position, so a typo does not shift the rest. */
export function countCorrect(passage: string, typed: string): number {
  let n = 0;
  for (let i = 0; i < typed.length && i < passage.length; i++) {
    if (typed[i] === passage[i]) n++;
  }
  return n;
}
