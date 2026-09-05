"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { BERRIES } from "@/lib/games/snake/constants";
import { createInitialState, facingOf, pause, queueDirection, start as startSnake, step, tickMsFor } from "@/lib/games/snake/engine";
import { seedFromRun } from "@/lib/games/snake/rng";
import type { Direction, SnakeState } from "@/lib/games/snake/types";
import { GameFrame } from "./GameFrame";
import { useMinigameRun } from "./useMinigameRun";

const SHOWDOWN = "https://play.pokemonshowdown.com/sprites";
const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
};

function spriteFor(species: string, facing: Direction) {
  if (facing === "up") return { src: `${SHOWDOWN}/ani-back/${species}.gif`, flip: false };
  return { src: `${SHOWDOWN}/ani/${species}.gif`, flip: facing === "right" };
}

function Sprite({ species, facing, className }: { species: string; facing: Direction; className?: string }) {
  const { src, flip } = spriteFor(species, facing);
  return (
    // Animated Showdown GIFs preserve the personality of the recruited party.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={species} draggable={false} className={`pointer-events-none select-none object-contain [image-rendering:pixelated] ${className ?? ""}`} style={{ transform: flip ? "scaleX(-1)" : undefined }} />
  );
}

export function PokeSnake() {
  const { status, run, result, error, start, settle, reset } = useMinigameRun("snake");
  const [state, setState] = useState<SnakeState>(() => createInitialState(1));
  const stateRef = useRef(state);
  const settled = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { stateRef.current = state; }, [state]);

  const end = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    void settle(stateRef.current.score);
  }, [settle]);

  // The reducer is pure; only its clock belongs in the component. Rescheduling
  // after each tick means the speed increase is visible on the very next move.
  useEffect(() => {
    if (status !== "playing" || state.status !== "running") return;
    const id = window.setTimeout(() => setState(step), tickMsFor(state.body.length));
    return () => window.clearTimeout(id);
  }, [status, state.status, state.ticks, state.body.length]);

  useEffect(() => {
    if (state.status === "over" && status === "playing") end();
  }, [end, state.status, status]);

  const begin = useCallback(async () => {
    const active = await start();
    if (!active) return;
    settled.current = false;
    setState({ ...createInitialState(seedFromRun(active.seed)), status: "running" });
  }, [start]);

  const turn = useCallback((direction: Direction) => {
    setState((previous) => queueDirection(previous.status === "idle" ? startSnake(previous) : previous, direction));
  }, []);
  const toggle = useCallback(() => setState((previous) => previous.status === "running" ? pause(previous) : startSnake(previous)), []);

  useEffect(() => {
    if (status !== "playing") return;
    const onKey = (event: KeyboardEvent) => {
      const direction = KEY_TO_DIRECTION[event.code];
      if (direction) { event.preventDefault(); turn(direction); return; }
      if (event.code === "Space") { event.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, toggle, turn]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setState((previous) => pause(previous));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const origin = touchStart.current;
    touchStart.current = null;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  };

  const { cols, rows, body, party, wild, berry, score, lastEvent } = state;
  const cellStyle = (x: number, y: number, transition = true) => ({
    left: `${(x * 100) / cols}%`, top: `${(y * 100) / rows}%`,
    width: `${100 / cols}%`, height: `${100 / rows}%`,
    transition: transition ? `left ${tickMsFor(body.length)}ms linear, top ${tickMsFor(body.length)}ms linear` : undefined,
  });

  return (
    <GameFrame
      name="PokéSnake"
      rule="Arrow keys, WASD, swipe, or the D-pad to steer Pikachu. Catch wild Pokémon to grow; berries are points only. Space pauses."
      status={status}
      error={error}
      result={result}
      palette={run?.equipped.palette ?? ["#69b66b", "#225c35"]}
      onStart={begin}
      onAgain={() => { reset(); void begin(); }}
      startLabel="Enter the grass"
      stats={status === "playing" ? [{ label: "Score", value: String(score) }, { label: "Party", value: String(party.length) }] : []}
    >
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-3 flex items-center justify-between rounded-pane bg-vitrine-2 px-3 py-2 text-xs ring-1 ring-seam">
          <span className="text-manila-2">Best <b className="text-brass">{run?.best ?? 0}</b></span>
          <span className="text-manila-2">{state.status === "paused" ? "Paused" : `${tickMsFor(party.length)} ms`}</span>
          <div className="flex gap-1.5">
            <button type="button" onClick={toggle} className="rounded-pane p-1.5 text-manila hover:bg-vitrine-3" aria-label={state.status === "running" ? "Pause" : "Resume"}>
              {state.status === "running" ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button type="button" onClick={end} className="rounded-pane p-1.5 text-manila hover:bg-vitrine-3" aria-label="End run">
              <RotateCcw size={15} />
            </button>
          </div>
        </div>

        <div
          className="relative touch-none overflow-hidden rounded-pane ring-2 [background-image:linear-gradient(45deg,color-mix(in_srgb,var(--cab-deep)_38%,transparent)_25%,transparent_25%,transparent_75%,color-mix(in_srgb,var(--cab-deep)_38%,transparent)_75%),linear-gradient(45deg,color-mix(in_srgb,var(--cab-deep)_38%,transparent)_25%,transparent_25%,transparent_75%,color-mix(in_srgb,var(--cab-deep)_38%,transparent)_75%)] [background-position:0_0,calc(200%/20)_calc(200%/16)] [background-size:calc(200%/20)_calc(200%/16)]"
          style={{ aspectRatio: `${cols} / ${rows}`, backgroundColor: run?.equipped.palette[0] ?? "#368e4a", borderColor: run?.equipped.palette[0] ?? "#8cdc83" }}
          onPointerDown={(event) => { touchStart.current = { x: event.clientX, y: event.clientY }; }}
          onPointerUp={onPointerUp}
        >
          {berry && (
            <div className="absolute grid place-items-center" style={cellStyle(berry.x, berry.y, false)} title={BERRIES[berry.kind].label}>
              <span className={berry.ttl < 10 && berry.ttl % 2 === 0 ? "opacity-35" : ""}>{({ oran: "🫐", pecha: "🍑", sitrus: "🍊", lum: "✨" })[berry.kind]}</span>
            </div>
          )}
          <div className="absolute flex items-end justify-center" style={cellStyle(wild.x, wild.y, false)}>
            <span className="absolute bottom-0 h-[28%] w-[68%] rounded-full bg-black/25 blur-[2px]" />
            <Sprite species={wild.species} facing="down" className="h-[145%] w-[145%] animate-bounce" />
          </div>
          {body.map((segment, index) => (
            <div key={index} className="absolute flex items-end justify-center" style={{ ...cellStyle(segment.x, segment.y), zIndex: body.length - index + 1 }}>
              <Sprite species={party[index]!} facing={facingOf(state, index)} className="h-[150%] w-[150%]" />
            </div>
          ))}
          {state.status === "paused" && <div className="absolute inset-0 grid place-items-center bg-black/55 text-sm font-semibold text-white backdrop-blur-[2px]">Paused · Space to resume</div>}
          {lastEvent && lastEvent.type !== "crash" && state.status === "running" && (
            <p className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
              {lastEvent.type === "caught" ? `${title(lastEvent.species)} joined! +${lastEvent.points}` : `${BERRIES[lastEvent.kind].label} +${lastEvent.points}`}
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-1 rounded-pane bg-vitrine-2 p-2 ring-1 ring-seam" aria-label="Your party">
          {party.map((species, index) => <Sprite key={`${species}-${index}`} species={species} facing="left" className="h-8 w-8" />)}
        </div>

        <div className="mx-auto mt-4 grid w-fit grid-cols-3 gap-1 sm:hidden">
          <span /><Pad onPress={() => turn("up")}>↑</Pad><span />
          <Pad onPress={() => turn("left")}>←</Pad><Pad onPress={() => turn("down")}>↓</Pad><Pad onPress={() => turn("right")}>→</Pad>
        </div>
      </div>
    </GameFrame>
  );
}

function Pad({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  return <button type="button" onPointerDown={(event) => { event.preventDefault(); onPress(); }} className="grid h-12 w-12 place-items-center rounded-pane bg-vitrine-2 text-manila ring-1 ring-seam">{children}</button>;
}

const title = (species: string) => species.charAt(0).toUpperCase() + species.slice(1);
