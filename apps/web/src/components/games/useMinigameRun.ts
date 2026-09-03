"use client";

import { useCallback, useRef, useState } from "react";
import type { Cents } from "@pcs/shared";
import type { Cosmetic, MinigameContent, MinigameId } from "@pcs/minigame-engine";
import { usePlayer } from "@/components/PlayerProvider";

/**
 * The run lifecycle, so no game component has to own it.
 *
 * Every game does the same three things: ask the server for a run, play it,
 * then hand back a score. Keeping that here means a game file is only ever
 * about its own rules, and there is exactly one place where a score is sent.
 */

export interface MatchFace {
  id: string;
  name: string;
  image: string;
}

export interface ActiveRun {
  runId: string;
  seed: string;
  content: MinigameContent;
  equipped: Cosmetic;
  capRemaining: Cents;
  best: number;
  faces?: MatchFace[];
}

export interface RunResult {
  score: number;
  payout: Cents;
  balanceAfter: Cents;
  capRemaining: Cents;
  capped: boolean;
  best: number;
}

export type RunStatus = "idle" | "starting" | "playing" | "settling" | "done";

export function useMinigameRun(game: MinigameId) {
  const { setCash, refresh } = usePlayer();
  const [status, setStatus] = useState<RunStatus>("idle");
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number>(0);

  const start = useCallback(async () => {
    setStatus("starting");
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/minigames/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not start that game");
        setStatus("idle");
        return null;
      }

      startedAt.current = performance.now();
      setRun(data);
      setStatus("playing");
      return data as ActiveRun;
    } catch {
      setError("Could not reach the arcade");
      setStatus("idle");
      return null;
    }
  }, [game]);

  /**
   * Hand the score back.
   *
   * The elapsed time is measured here rather than accumulated by the game, so
   * a game that pauses cannot accidentally under-report and trip a ceiling.
   */
  const settle = useCallback(
    async (score: number) => {
      if (!run) return null;
      setStatus("settling");

      const durationMs = Math.round(performance.now() - startedAt.current);

      try {
        const res = await fetch("/api/minigames/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: run.runId, score, durationMs }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not settle that run");
          setStatus("done");
          return null;
        }

        // Push the balance into the shell so the header moves immediately,
        // the way the missions page does after a claim.
        setCash(data.balanceAfter);
        void refresh();
        setResult(data);
        setStatus("done");
        return data as RunResult;
      } catch {
        setError("Could not reach the arcade");
        setStatus("done");
        return null;
      }
    },
    [run, setCash, refresh],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setRun(null);
    setResult(null);
    setError(null);
  }, []);

  return { status, run, result, error, start, settle, reset };
}
