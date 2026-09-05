"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { CircleStop, Pause, Play, Sparkles } from "lucide-react";
import { BERRIES, SHINY_WILD_POINTS } from "@/lib/games/snake/constants";
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

const ITEM_ICON = `${SHOWDOWN}/itemicons`;

function spriteFor(species: string, facing: Direction, shiny: boolean) {
  const set = facing === "up" ? `ani-back${shiny ? "-shiny" : ""}` : `ani${shiny ? "-shiny" : ""}`;
  return { src: `${SHOWDOWN}/${set}/${species}.gif`, flip: facing === "right" };
}

function Sprite({ species, facing, shiny = false, className }: { species: string; facing: Direction; shiny?: boolean; className?: string }) {
  const { src, flip } = spriteFor(species, facing, shiny);
  return (
    // Animated Showdown GIFs preserve the personality of the recruited party.
    // eslint-disable-next-line @next/next/no-img-element
    <img key={src} src={src} alt={shiny ? `Shiny ${species}` : species} draggable={false} className={`pointer-events-none select-none object-contain [image-rendering:pixelated] ${className ?? ""}`} style={{ transform: flip ? "scaleX(-1)" : undefined }} />
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

  const { cols, rows, body, party, wild, berry, star, shinyPending, score, lastEvent } = state;
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
    >
      <div className="snake-console mx-auto w-full max-w-3xl">
        <div className="snake-hud">
          <dl className="snake-scoreboard">
            <HudStat label="Score" value={score} bright />
            <HudStat label="Best" value={run?.best ?? 0} />
            <HudStat label="Party" value={party.length} />
          </dl>
          <div className="flex items-center gap-2">
            <span className={`snake-status ${shinyPending ? "snake-status--shiny" : ""}`}>
              {shinyPending ? <><Sparkles size={13} /> Shiny ready</> : state.status === "paused" ? "Paused" : `${tickMsFor(party.length)} ms pace`}
            </span>
            <button type="button" onClick={toggle} className="rounded-pane p-1.5 text-manila hover:bg-vitrine-3" aria-label={state.status === "running" ? "Pause" : "Resume"}>
              {state.status === "running" ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button type="button" onClick={end} className="rounded-pane p-1.5 text-manila hover:bg-vitrine-3" aria-label="End run">
              <CircleStop size={15} />
            </button>
          </div>
        </div>

        <div
          className="snake-field"
          style={{ aspectRatio: `${cols} / ${rows}`, ["--snake-grass" as string]: run?.equipped.palette[0] ?? "#368e4a", ["--snake-shadow" as string]: run?.equipped.palette[1] ?? "#225c35" }}
          onPointerDown={(event) => { touchStart.current = { x: event.clientX, y: event.clientY }; }}
          onPointerUp={onPointerUp}
        >
          <div className="snake-field__texture" aria-hidden="true" />
          <div className="snake-field__grid" aria-hidden="true" />
          {berry && (
            <div className={`snake-pickup ${berry.ttl < 10 && berry.ttl % 2 === 0 ? "opacity-30" : ""}`} style={cellStyle(berry.x, berry.y, false)} title={BERRIES[berry.kind].label}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${ITEM_ICON}/${berry.kind}-berry.png`} alt={BERRIES[berry.kind].label} className="snake-item-icon" draggable={false} />
            </div>
          )}
          {star && (
            <div className={`snake-pickup snake-pickup--star ${star.ttl < 10 && star.ttl % 2 === 0 ? "opacity-25" : ""}`} style={cellStyle(star.x, star.y, false)} title="Shiny Star">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${ITEM_ICON}/star-piece.png`} alt="Shiny Star" className="snake-item-icon" draggable={false} />
            </div>
          )}
          <div key={`${wild.species}-${wild.shiny}-${wild.x}-${wild.y}`} className={`snake-wild ${wild.shiny ? "snake-wild--shiny" : ""}`} style={cellStyle(wild.x, wild.y, false)}>
            <span className="absolute bottom-0 h-[28%] w-[68%] rounded-full bg-black/25 blur-[2px]" />
            {wild.shiny && <Sparkles aria-hidden="true" className="snake-wild__sparkle" size={17} />}
            <Sprite species={wild.species} shiny={wild.shiny} facing="down" className="h-[145%] w-[145%]" />
          </div>
          {body.map((segment, index) => (
            <div key={index} className="snake-segment" style={{ ...cellStyle(segment.x, segment.y), zIndex: body.length - index + 4 }}>
              <Sprite species={party[index]!.species} shiny={party[index]!.shiny} facing={facingOf(state, index)} className="h-[150%] w-[150%]" />
            </div>
          ))}
          {state.status === "paused" && <div className="snake-pause">Paused <span>Press Space to resume</span></div>}
          {lastEvent && lastEvent.type !== "crash" && state.status === "running" && (
            <p key={state.ticks} className={`snake-toast ${lastEvent.type === "star" || (lastEvent.type === "caught" && lastEvent.shiny) ? "snake-toast--shiny" : ""}`}>
              {eventCopy(lastEvent)}
            </p>
          )}
        </div>

        <div className="snake-underboard">
          <div className="snake-party" aria-label="Your party">
            <span className="snake-underboard__label">Your party</span>
            <div className="flex min-w-0 flex-wrap gap-0.5">
              {party.map((member, index) => <Sprite key={`${member.species}-${member.shiny}-${index}`} species={member.species} shiny={member.shiny} facing="left" className="h-8 w-8" />)}
            </div>
          </div>
          <div className="snake-legend" aria-label="Pickups">
            {(Object.keys(BERRIES) as (keyof typeof BERRIES)[]).map((kind) => (
              <span key={kind} title={`${BERRIES[kind].label}: ${BERRIES[kind].points} points`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${ITEM_ICON}/${kind}-berry.png`} alt="" /> +{BERRIES[kind].points}
              </span>
            ))}
            <span className="snake-legend__star" title={`The next wild Pokémon is shiny and worth ${SHINY_WILD_POINTS} points`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${ITEM_ICON}/star-piece.png`} alt="" /> shiny +{SHINY_WILD_POINTS}
            </span>
          </div>
        </div>

        <div className="snake-dpad">
          <span /><Pad onPress={() => turn("up")}>↑</Pad><span />
          <Pad onPress={() => turn("left")}>←</Pad><Pad onPress={() => turn("down")}>↓</Pad><Pad onPress={() => turn("right")}>→</Pad>
        </div>
      </div>
    </GameFrame>
  );
}

function Pad({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  return <button type="button" onPointerDown={(event) => { event.preventDefault(); onPress(); }} className="snake-dpad__key">{children}</button>;
}

const title = (species: string) => species.charAt(0).toUpperCase() + species.slice(1);

function HudStat({ label, value, bright = false }: { label: string; value: number; bright?: boolean }) {
  return <div><dt>{label}</dt><dd className={bright ? "text-brass" : ""}>{value}</dd></div>;
}

function eventCopy(event: Exclude<SnakeState["lastEvent"], null | { type: "crash" }>): string {
  if (event.type === "star") return "Shiny Star! Your next wild Pokémon will sparkle.";
  if (event.type === "caught") return `${event.shiny ? "Shiny " : ""}${title(event.species)} joined! +${event.points}`;
  return `${BERRIES[event.kind].label} +${event.points}`;
}
