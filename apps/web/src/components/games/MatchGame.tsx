"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MATCH_PAIRS } from "@pcs/minigame-engine";
import { cn } from "@/lib/cn";
import { useMinigameRun, type MatchFace } from "./useMinigameRun";
import { GameFrame } from "./GameFrame";

/**
 * Card Match.
 *
 * Twelve pairs of real card art, face down. The layout comes from the run's
 * seed, so reloading deals the same board rather than a friendlier one.
 *
 * Scoring is deliberately weighted towards moves rather than seconds:
 *
 *     score = 1000 - (moves - 12) * 25 - elapsedSeconds * 5
 *
 * Twelve moves is a perfect board. Careful play should beat frantic play,
 * because remembering where a card was is the actual skill.
 */

const PERFECT_MOVES = MATCH_PAIRS;
const MOVE_PENALTY = 25;
const SECOND_PENALTY = 5;
const BASE_SCORE = 1000;
/** How long a mismatched pair stays visible before turning back over. */
const PEEK_MS = 700;

export function scoreBoard(moves: number, elapsedSeconds: number): number {
  const raw =
    BASE_SCORE -
    Math.max(0, moves - PERFECT_MOVES) * MOVE_PENALTY -
    Math.floor(elapsedSeconds) * SECOND_PENALTY;
  return Math.max(0, Math.round(raw));
}

export function MatchGame() {
  const { status, run, result, error, start, settle, reset } = useMinigameRun("match");

  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [moves, setMoves] = useState(0);
  const [locked, setLocked] = useState(false);
  const startedAt = useRef(0);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const layout = useMemo(
    () => (run?.content.kind === "match" ? run.content.layout : []),
    [run],
  );
  const faces: MatchFace[] = useMemo(() => run?.faces ?? [], [run]);
  const palette = run?.equipped.palette ?? ["#3a5aa8", "#1a2a5a"];

  useEffect(() => () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
  }, []);

  const begin = useCallback(async () => {
    setFlipped([]);
    setMatched(new Set());
    setMoves(0);
    setLocked(false);
    startedAt.current = 0;
    await start();
  }, [start]);

  const flip = useCallback((cell: number) => {
    if (locked || matched.has(cell) || flipped.includes(cell)) return;
    if (startedAt.current === 0) startedAt.current = performance.now();

    const next = [...flipped, cell];
    setFlipped(next);
    if (next.length < 2) return;

    const [a, b] = next as [number, number];
    const isPair = layout[a] === layout[b];
    setMoves((m) => m + 1);

    if (isPair) {
      const grown = new Set(matched).add(a).add(b);
      setMatched(grown);
      setFlipped([]);

      if (grown.size === MATCH_PAIRS * 2) {
        const elapsed = (performance.now() - startedAt.current) / 1000;
        void settle(scoreBoard(moves + 1, elapsed));
      }
      return;
    }

    // Hold the mismatch on screen long enough to be read, and ignore input
    // during it — otherwise a fast clicker flips a third card mid-peek.
    setLocked(true);
    peekTimer.current = setTimeout(() => {
      setFlipped([]);
      setLocked(false);
    }, PEEK_MS);
  }, [locked, matched, flipped, layout, moves, settle]);

  const remaining = MATCH_PAIRS - matched.size / 2;

  return (
    <GameFrame
      name="Card Match"
      rule="Twelve pairs, face down. Fewer moves is worth more than fewer seconds."
      status={status}
      error={error}
      result={result}
      palette={palette}
      onStart={begin}
      onAgain={() => { reset(); void begin(); }}
      startLabel="Deal the board"
      stats={
        status === "playing"
          ? [
              { label: "Moves", value: String(moves) },
              { label: "Pairs left", value: String(remaining) },
            ]
          : []
      }
    >
      {run && (
        <div
          className="match-grid"
          style={{
            ["--cab" as string]: palette[0],
            ["--cab-deep" as string]: palette[1],
          }}
        >
          {layout.map((pair, cell) => {
            const isUp = flipped.includes(cell) || matched.has(cell);
            const face = faces[pair];

            return (
              <button
                key={cell}
                type="button"
                onClick={() => flip(cell)}
                disabled={isUp || locked || status !== "playing"}
                aria-label={isUp && face ? face.name : `Face-down card ${cell + 1}`}
                className={cn(
                  "match-cell",
                  isUp && "match-cell--face-up",
                  matched.has(cell) && "match-cell--matched",
                )}
              >
                <span className="match-cell__inner">
                  <span className="match-cell__face match-cell__face--back" />
                  <span className="match-cell__face match-cell__face--front">
                    {face && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={face.image}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="eager"
                      />
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </GameFrame>
  );
}
