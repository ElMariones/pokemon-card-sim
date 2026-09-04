"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SNAKE_BERRY_POINTS, SNAKE_POKEMON_POINTS } from "@pcs/minigame-engine";
import { cn } from "@/lib/cn";
import { BerryGlyph } from "./CosmeticArt";
import { GameFrame } from "./GameFrame";
import { useMinigameRun } from "./useMinigameRun";
import { useSpriteGeometry } from "./useSpriteGeometry";

/**
 * Poké Snake.
 *
 * Classic grid snake, played on a moonlit meadow — with one twist: the food
 * that grows you is wild Pokémon, and every one you catch lines up behind you
 * as an animated follower, so your tail becomes a parade of what you have
 * caught. Berries are the other food: pure points, no growth.
 *
 * Like flappy, this renders in the DOM rather than on a canvas because the
 * sprites are animated GIFs and `drawImage` paints only their first frame.
 * The field is a fixed 24x16 grid of 30px cells inside the same scaled
 * coordinate space flappy uses, and each member of the parade is an <img>
 * drawn from its *measured body*, so a Caterpie and a Magikarp sit on their
 * cells as if they belong to the same parade.
 *
 * The snack stream — which spawns are berries, which are wild Pokémon, and in
 * what order — comes from the run's seed, the same stream the server rebuilds
 * to put a ceiling on the score. Positions are the browser's to roll: they
 * never enter the settlement, only the order of what could be eaten does.
 *
 * Honest-play constants vs the server's plausibility ceiling: a new snack
 * spawns at most every 800ms and never on the snake, against a ceiling of one
 * item per 650ms — real play is never refused.
 */

const CELL = 30;
const COLS = 24;
const ROWS = 16;
const W = COLS * CELL;
const H = ROWS * CELL;

/** How long after a snack is eaten the next one appears. */
const SPAWN_DELAY_MS = 800;
/** New snacks keep this many cells clear of the head. */
const MIN_SPAWN_DISTANCE = 6;

/** The cadence steps up as the parade grows. */
const TICK_START_MS = 150;
const TICK_MIN_MS = 85;
const TICK_PER_FOLLOWER_MS = 2;

/** The parade is drawn at body scale: followers at one size, the head a
 * little bigger so it reads as the leader. */
const BODY_MAX = 24;
const HEAD_MAX = 28;
/** Wild Pokémon snacks are a touch bigger than followers — they are the
 * prize, and you are meant to see them coming. */
const FOOD_MAX = 29;

/** A swipe shorter than this is a tap, not a turn. */
const SWIPE_MIN_PX = 24;

const START = { x: 4, y: 8 };

interface Seg {
  x: number;
  y: number;
  /** Dex of the sprite this link shows: the head's cosmetic for link 0. */
  dex: number;
}

interface Dir {
  x: number;
  y: number;
}

interface PlacedFood {
  kind: "berry" | "pokemon";
  dex?: number;
  x: number;
  y: number;
}

interface Pop {
  id: number;
  x: number;
  y: number;
  text: string;
  pokemon: boolean;
}

const spriteSrc = (dex: number) => `/sprites/pokemon/${dex}.gif`;

const DIRS: Record<string, Dir> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
  W: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  A: { x: -1, y: 0 },
  D: { x: 1, y: 0 },
};

/** The meadow's wild roster, by dex — display names for the catch toast. */
const DEX_NAME: Record<number, string> = {
  10: "Caterpie", 13: "Weedle", 39: "Jigglypuff", 52: "Meowth", 54: "Psyduck",
  63: "Abra", 81: "Magnemite", 92: "Gastly", 118: "Goldeen", 129: "Magikarp",
  133: "Eevee", 152: "Chikorita", 155: "Cyndaquil", 158: "Totodile",
  161: "Sentret", 179: "Mareep", 187: "Hoppip", 194: "Wooper",
  263: "Zigzagoon", 265: "Wurmple", 280: "Ralts", 300: "Skitty",
  325: "Spoink", 399: "Bidoof",
};

export function SnakeGame() {
  const { status, run, result, error, start, settle, reset } = useMinigameRun("snake");

  const [score, setScore] = useState(0);
  /** The parade, head first. Refs are the loop's source of truth; state is
   * the render's. */
  const [segs, setSegs] = useState<Seg[]>([]);
  const [food, setFood] = useState<PlacedFood | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  /** Which way the head faces: front sprites face left, so the whole parade
   * mirrors when it travels right. Mirrored in state because render reads it. */
  const [facingRight, setFacingRight] = useState(true);

  const segsRef = useRef<Seg[]>([]);
  const foodRef = useRef<PlacedFood | null>(null);
  const dirRef = useRef<Dir>({ x: 1, y: 0 });
  const queueRef = useRef<Dir[]>([]);
  const scoreRef = useRef(0);
  const foodIdxRef = useRef(0);
  const spawnAtRef = useRef(0);
  const runningRef = useRef(false);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const accRef = useRef(0);
  const popIdRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeRef = useRef<{ x: number; y: number } | null>(null);

  const headDex = run?.equipped.sprite ?? 23;
  const palette = run?.equipped.palette ?? ["#a06ec8", "#54307a"];
  const foods = useMemo(
    () => (run?.content.kind === "snake" ? run.content.foods : []),
    [run],
  );

  const end = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    void settle(scoreRef.current);
  }, [settle]);

  const endRef = useRef(end);
  useEffect(() => {
    endRef.current = end;
  }, [end]);

  const tickMs = () =>
    Math.max(TICK_MIN_MS, TICK_START_MS - (segsRef.current.length - 1) * TICK_PER_FOLLOWER_MS);

  /**
   * Pick where the next snack appears: an empty cell, at least
   * MIN_SPAWN_DISTANCE cells from the head when one exists, and reachable
   * without crossing the snake — a berry inside a loop the snake has drawn
   * around itself would be a snack that can never be eaten.
   */
  const pickSpawn = useCallback((): { x: number; y: number } | null => {
    const segs = segsRef.current;
    const head = segs[0];
    if (!head) return null;

    // The tail cell vacates as the head arrives, so it is not an obstacle.
    const occupied = new Set<number>();
    for (let i = 0; i < segs.length - 1; i++) {
      const s = segs[i]!;
      occupied.add(s.y * COLS + s.x);
    }

    // Flood from the head's cell over unoccupied cells: the food must sit in
    // the region the snake can actually still reach.
    const reachable = new Uint8Array(COLS * ROWS);
    const frontier: number[] = [];
    const headIdx = head.y * COLS + head.x;
    reachable[headIdx] = 1;
    frontier.push(headIdx);
    for (let q = 0; q < frontier.length; q++) {
      const idx = frontier[q]!;
      const x = idx % COLS;
      const y = (idx / COLS) | 0;
      if (x > 0) tryReach(idx - 1);
      if (x < COLS - 1) tryReach(idx + 1);
      if (y > 0) tryReach(idx - COLS);
      if (y < ROWS - 1) tryReach(idx + COLS);
    }
    function tryReach(idx: number) {
      if (reachable[idx] || occupied.has(idx)) return;
      reachable[idx] = 1;
      frontier.push(idx);
    }

    const far: number[] = [];
    const near: number[] = [];
    for (let idx = 0; idx < COLS * ROWS; idx++) {
      if (!reachable[idx] || occupied.has(idx)) continue;
      const x = idx % COLS;
      const y = (idx / COLS) | 0;
      if (Math.abs(x - head.x) + Math.abs(y - head.y) >= MIN_SPAWN_DISTANCE) far.push(idx);
      else near.push(idx);
    }
    const pick = far.length > 0 ? far : near;
    if (pick.length === 0) return null;
    const idx = pick[Math.floor(Math.random() * pick.length)]!;
    return { x: idx % COLS, y: (idx / COLS) | 0 };
  }, []);

  /** Put the next snack of the seeded stream on the field. */
  const spawnNext = useCallback(() => {
    const item = foods[foodIdxRef.current];
    if (!item) return;
    const cell = pickSpawn();
    if (!cell) return; // meadow full of parade — retried next frame
    foodIdxRef.current += 1;
    const placed: PlacedFood =
      item.kind === "berry" ? { kind: "berry", ...cell } : { kind: "pokemon", dex: item.dex, ...cell };
    foodRef.current = placed;
    setFood(placed);
  }, [foods, pickSpawn]);

  useEffect(() => {
    if (status !== "playing" || !run) return;

    // All the state the render shows was cleared by `begin`; from here the
    // loop owns the run and the render catches up on its first tick.
    segsRef.current = [{ x: START.x, y: START.y, dex: headDex }];
    dirRef.current = { x: 1, y: 0 };
    queueRef.current = [];
    scoreRef.current = 0;
    foodIdxRef.current = 0;
    accRef.current = 0;
    spawnAtRef.current = 0;
    runningRef.current = true;
    lastFrameRef.current = performance.now();
    // The first snack is placed by the first frame: spawnAtRef is in the
    // past and the field starts empty.
    foodRef.current = null;

    function step(now: number) {
      const queued = queueRef.current.shift();
      if (queued) dirRef.current = queued;
      if (dirRef.current.x !== 0) {
        const right = dirRef.current.x === 1;
        setFacingRight(right);
      }

      const segs = segsRef.current;
      const head = segs[0]!;
      const nx = head.x + dirRef.current.x;
      const ny = head.y + dirRef.current.y;

      // The fence around the meadow is fatal.
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
        endRef.current();
        return;
      }

      // Self-collision. The tail cell is allowed: it vacates this very tick
      // unless a Pokémon was caught, and nothing catchable ever sits on the
      // snake — so the check runs to the second-to-last link.
      for (let i = 1; i < segs.length - 1; i++) {
        const s = segs[i]!;
        if (s.x === nx && s.y === ny) {
          endRef.current();
          return;
        }
      }

      const at = foodRef.current;
      const caught = at && at.x === nx && at.y === ny ? at : null;
      const grow = caught?.kind === "pokemon";

      const out: Seg[] = [{ x: nx, y: ny, dex: head.dex }];
      for (let i = 1; i < segs.length; i++) {
        const prev = segs[i - 1]!;
        out.push({ x: prev.x, y: prev.y, dex: segs[i]!.dex });
      }
      if (grow && caught && caught.dex) {
        const tail = segs[segs.length - 1]!;
        // The tail holds still for this tick and the catch becomes the new
        // last link: the Pokémon really does line up at the back.
        out.push({ x: tail.x, y: tail.y, dex: caught.dex });
      }
      segsRef.current = out;
      setSegs(out);

      if (caught) {
        const points = caught.kind === "berry" ? SNAKE_BERRY_POINTS : SNAKE_POKEMON_POINTS;
        scoreRef.current += points;
        setScore(scoreRef.current);
        foodRef.current = null;
        setFood(null);
        spawnAtRef.current = now + SPAWN_DELAY_MS;

        const pop: Pop = {
          id: ++popIdRef.current,
          x: caught.x,
          y: caught.y,
          text: `+${points}`,
          pokemon: caught.kind === "pokemon",
        };
        setPops((p) => [...p, pop]);
        setTimeout(() => {
          setPops((p) => p.filter((x) => x.id !== pop.id));
        }, 800);

        if (caught.kind === "pokemon") {
          const name = DEX_NAME[caught.dex ?? -1] ?? "A wild Pokémon";
          setToast(`${name} joined your parade!`);
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(() => setToast(null), 1700);
        }
      }
    }

    function frame(now: number) {
      if (!runningRef.current) return;
      // A slow frame must not teleport the head through a fence it never saw.
      const dt = Math.min(0.1, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;

      const tick = tickMs();
      accRef.current += dt * 1000;
      while (runningRef.current && accRef.current >= tick) {
        accRef.current -= tick;
        step(now);
      }

      // A snack was eaten and its respawn delay has passed: place the next
      // item of the seeded stream.
      if (runningRef.current && !foodRef.current && now >= spawnAtRef.current) {
        spawnNext();
      }
      if (runningRef.current) rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      runningRef.current = false;
      cancelAnimationFrame(rafRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
    // Deliberately [status, run]: the loop reads everything else through
    // refs, because a dependency that changed mid-run would re-run this
    // effect and reset the parade mid-meadow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, run]);

  const turn = useCallback((dir: Dir) => {
    if (!runningRef.current) return;
    const queue = queueRef.current;
    const last = queue.length > 0 ? queue[queue.length - 1]! : dirRef.current;
    if (dir.x === last.x && dir.y === last.y) return; // already heading there
    if (dir.x === -last.x && dir.y === -last.y) return; // no reversing into yourself
    if (queue.length >= 2) return; // two buffered turns is plenty
    queue.push(dir);
  }, []);

  // Keyboard steering: arrows and WASD. Space stays free for flappy fans.
  useEffect(() => {
    if (status !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      const dir = DIRS[e.key];
      if (!dir) return;
      e.preventDefault();
      turn(dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, turn]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    swipeRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
    turn(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) });
  }, [turn]);

  // A hidden tab throttles rAF to roughly once a second. Left running, the
  // player would come back to a crash they never steered around, so the run
  // ends on the spot and pays out whatever it had already earned.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && runningRef.current) endRef.current();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const begin = useCallback(async () => {
    setScore(0);
    setSegs([]);
    setFood(null);
    setToast(null);
    setPops([]);
    setFacingRight(true);
    await start();
  }, [start]);

  const paradeLen = Math.max(0, segs.length - 1);
  const playing = status === "playing" || status === "settling";

  return (
    <GameFrame
      name="Poké Snake"
      rule="Steer with the arrow keys or WASD — or swipe, on touch. Berries are worth a point; catch a wild Pokémon for two, and it lines up behind you. The fence and your own tail both end the run."
      status={status}
      error={error}
      result={result}
      palette={palette}
      onStart={begin}
      onAgain={() => {
        reset();
        void begin();
      }}
      startLabel="Into the meadow"
      stats={
        playing
          ? [
              { label: "Points", value: String(score) },
              { label: "Parade", value: String(paradeLen) },
            ]
          : []
      }
    >
      <div
        className="playfield playfield--meadow mx-auto w-full"
        style={{ maxWidth: W, aspectRatio: `${W} / ${H}`, touchAction: "none" }}
        aria-label="Meadow playfield — steer with the arrow keys, WASD, or a swipe"
        role="application"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeRef.current = null;
        }}
      >
        {/* The fixed coordinate space, scaled to the rendered width: the game
            is identical on a phone and on a desktop. */}
        <div
          className="snake-board absolute left-0 top-0 origin-top-left"
          style={{ width: W, height: H, transform: "scale(var(--field-scale, 1))" }}
        >
          {/* The meadow, back to front. */}
          <div className="snake-moon" aria-hidden="true" />
          <div className="snake-fly snake-fly--a" aria-hidden="true" />
          <div className="snake-fly snake-fly--b" aria-hidden="true" />
          <div className="snake-tufts" aria-hidden="true" />

          {/* The snack, waiting. */}
          {food && (
            <span
              key={`${food.kind}-${food.dex ?? "berry"}`}
              className="snake-seg absolute left-0 top-0 block will-change-transform"
              style={{ transform: `translate3d(${food.x * CELL}px, ${food.y * CELL}px, 0)` }}
            >
              <span className="snake-food__bob block">
                {food.kind === "berry" ? (
                  <span className="snake-food__berry">
                    <BerryGlyph px={CELL - 6} />
                  </span>
                ) : (
                  <FoodSprite dex={food.dex ?? 10} bodyMax={FOOD_MAX} />
                )}
              </span>
            </span>
          )}

          {/* The parade: followers first, the head on top of the paint order.
              Front sprites face left, so the whole parade mirrors to face the
              way it is travelling. */}
          {segs.map((seg, i) =>
            i === 0 ? null : (
              <CellSprite key={i} seg={seg} bodyMax={BODY_MAX} flip={facingRight} />
            ),
          )}
          {segs[0] && (
            <CellSprite
              key="head"
              seg={segs[0]}
              bodyMax={HEAD_MAX}
              flip={facingRight}
              className="snake-head"
            />
          )}

          {/* Floating +1/+2 over the cell that was just eaten. */}
          {pops.map((pop) => (
            <span
              key={pop.id}
              className={cn("snake-pop", pop.pokemon ? "snake-pop--pokemon" : "snake-pop--berry")}
              style={{ left: pop.x * CELL + CELL / 2, top: pop.y * CELL + CELL / 2 }}
            >
              {pop.text}
            </span>
          ))}

          {toast && <p className="snake-toast">{toast}</p>}
        </div>

        <FieldScale width={W} />
      </div>
    </GameFrame>
  );
}

/** One link of the parade sitting on its cell, sized to its measured body. */
function CellSprite({
  seg,
  bodyMax,
  flip = false,
  className,
}: {
  seg: Seg;
  bodyMax: number;
  /** Front sprites face left; the parade faces the way it travels. */
  flip?: boolean;
  className?: string;
}) {
  const src = spriteSrc(seg.dex);
  const { w, h, cx, cy } = useSpriteGeometry(src, bodyMax);
  return (
    <span
      className={cn("snake-seg absolute left-0 top-0 block will-change-transform", className)}
      style={{ transform: `translate3d(${seg.x * CELL}px, ${seg.y * CELL}px, 0)` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        className={cn("pixel block", flip && "-scale-x-100")}
        style={{
          width: w,
          height: h,
          // Centre the *body* on the cell: the frame's empty margins must not
          // push Caterpie off his square.
          transform: `translate(${CELL / 2 - cx * w}px, ${CELL / 2 - cy * h}px)`,
        }}
      />
    </span>
  );
}

/** A wild Pokémon waiting to be caught on its cell. */
function FoodSprite({ dex, bodyMax }: { dex: number; bodyMax: number }) {
  const src = spriteSrc(dex);
  const { w, h, cx, cy } = useSpriteGeometry(src, bodyMax);
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt=""
      draggable={false}
      className="pixel block"
      style={{
        width: w,
        height: h,
        transform: `translate(${CELL / 2 - cx * w}px, ${CELL / 2 - cy * h}px)`,
      }}
    />
  );
}

/** Keep the fixed playfield coordinate space fitted to the rendered width. */
function FieldScale({ width }: { width: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const field = ref.current?.parentElement;
    if (!field) return;

    const apply = () => {
      field.style.setProperty("--field-scale", String(field.clientWidth / width));
    };
    apply();

    const ro = new ResizeObserver(apply);
    ro.observe(field);
    return () => ro.disconnect();
  }, [width]);

  return <span ref={ref} hidden />;
}
