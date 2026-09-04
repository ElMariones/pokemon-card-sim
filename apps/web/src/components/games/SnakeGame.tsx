"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import {
  SNAKE_BERRIES, SNAKE_COLS, SNAKE_MIN_TICK_MS, SNAKE_POINTS_BERRY, SNAKE_POINTS_POKEMON,
  SNAKE_ROSTER, SNAKE_ROWS, seedRng, type Rng,
} from "@pcs/minigame-engine";
import { useMinigameRun } from "./useMinigameRun";
import { GameFrame } from "./GameFrame";

/**
 * Pokémon Parade — Snake, where the snake is a queue of Pokémon.
 *
 * You start as one Pikachu. Wild Pokémon wander onto the meadow one at a
 * time; walk into one and it falls in behind you. Berries appear too, and are
 * worth less, because a berry does not lengthen the line and the line is the
 * whole difficulty.
 *
 * Rendered in the DOM, like Flappy and for the same reason: the sprites are
 * animated GIFs and a canvas would paint only their first frame. Every member
 * of the line is its own <img>, and every one of them faces the way it is
 * walking — the Gen V front sprite faces the viewer and a little to the left,
 * so it does "down" and "left" as drawn, "right" mirrored; the back sprite does
 * "up". Swapping src on an <img> restarts the GIF, so the src is only touched
 * when the direction actually changes.
 *
 * The grid is fixed and the playfield scales, so the game is identical on a
 * phone and a desktop. The tick never drops below SNAKE_MIN_TICK_MS, which is
 * the number the server's plausibility ceiling is built on.
 */

const CELL = 30;
const W = SNAKE_COLS * CELL;   // 720
const H = SNAKE_ROWS * CELL;   // 450

/** How the tick shortens as the line grows: comfortable at first, sharp later. */
const TICK_START_MS = 210;
const TICK_STEP_MS = 5;

/** A sprite's box, a touch larger than its cell so the line reads as a crowd. */
const SPRITE_BOX = 42;
const BERRY_BOX = 26;

/** Berries are a bonus, not a plan: they come and go on their own clock. */
const BERRY_EVERY_MS = 4_200;
const BERRY_LIFE_MS = 7_500;
const BERRIES_MAX = 2;

/** Cells nearer than this to the head are never spawned on; it would feel like a gift. */
const SPAWN_CLEARANCE = 3;

type Dir = "up" | "down" | "left" | "right";

const DELTA: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };

interface Segment {
  x: number;
  y: number;
  /** Where this segment was one tick ago, for the in-between frames. */
  px: number;
  py: number;
  dir: Dir;
  dex: number;
}

interface Visitor { x: number; y: number; dex: number }
interface Berry { x: number; y: number; kind: number; bornAt: number }

const frontSrc = (dex: number) => `/sprites/pokemon/${dex}.gif`;
const backSrc = (dex: number) => `/sprites/pokemon/back/${dex}.gif`;

/** Which GIF, and whether it is mirrored, for a Pokémon walking in `dir`. */
function faceFor(dex: number, dir: Dir): { src: string; flip: boolean } {
  switch (dir) {
    case "up": return { src: backSrc(dex), flip: false };
    case "right": return { src: frontSrc(dex), flip: true };
    case "left":
    case "down":
      return { src: frontSrc(dex), flip: false };
  }
}

export function SnakeGame() {
  const { status, run, result, error, start, settle, reset } = useMinigameRun("snake");
  const [score, setScore] = useState(0);
  const [length, setLength] = useState(1);

  const lineLayer = useRef<HTMLDivElement>(null);
  const pickupLayer = useRef<HTMLDivElement>(null);
  const popLayer = useRef<HTMLDivElement>(null);

  // Simulation state in refs: the loop runs every frame and must not re-render.
  const segments = useRef<Segment[]>([]);
  const dir = useRef<Dir>("right");
  const queued = useRef<Dir[]>([]);
  const visitor = useRef<Visitor | null>(null);
  const berries = useRef<Berry[]>([]);
  const tickAcc = useRef(0);
  const tickMs = useRef(TICK_START_MS);
  const berryAcc = useRef(0);
  const nextVisitor = useRef(0);
  const rng = useRef<Rng>(() => Math.random());
  const scoreRef = useRef(0);
  const running = useRef(false);
  const raf = useRef(0);
  const lastFrame = useRef(0);
  const clock = useRef(0);

  const leader = run?.equipped.sprite ?? 25;
  const palette = run?.equipped.palette ?? ["#f2cb45", "#8a6a2a"];

  const end = useCallback(() => {
    if (!running.current) return;
    running.current = false;
    cancelAnimationFrame(raf.current);
    void settle(scoreRef.current);
  }, [settle]);
  const endRef = useRef(end);
  useEffect(() => { endRef.current = end; }, [end]);

  /**
   * Turn. Turns are queued, two deep, and applied one per tick — so a quick
   * "up, left" at a corner does both, in order, instead of losing the second.
   * A reversal is dropped: walking back into yourself is never what was meant.
   */
  const steer = useCallback((next: Dir) => {
    if (!running.current) return;
    const q = queued.current;
    const last = q.length > 0 ? q[q.length - 1]! : dir.current;
    if (next === last || next === OPPOSITE[last]) return;
    if (q.length >= 2) return;
    q.push(next);
  }, []);

  useEffect(() => {
    if (status !== "playing" || !run) return;

    const visitors = run.content.kind === "snake" ? run.content.visitors : [];
    // A separate stream from the one that built the content, so the client
    // cannot "know" the server's visitor order by re-rolling the same seed.
    rng.current = seedRng(`${run.seed}:board`);

    const sx = Math.floor(SNAKE_COLS / 3);
    const sy = Math.floor(SNAKE_ROWS / 2);
    segments.current = [{ x: sx, y: sy, px: sx, py: sy, dir: "right", dex: leader }];
    dir.current = "right";
    queued.current = [];
    berries.current = [];
    tickAcc.current = 0;
    tickMs.current = TICK_START_MS;
    berryAcc.current = BERRY_EVERY_MS * 0.6;
    nextVisitor.current = 0;
    scoreRef.current = 0;
    clock.current = 0;
    running.current = true;
    lastFrame.current = performance.now();

    const occupied = () => {
      const set = new Set<number>();
      for (const s of segments.current) set.add(s.y * SNAKE_COLS + s.x);
      if (visitor.current) set.add(visitor.current.y * SNAKE_COLS + visitor.current.x);
      for (const b of berries.current) set.add(b.y * SNAKE_COLS + b.x);
      return set;
    };

    /** A free cell, not right in front of the head. Null when the board is full. */
    const freeCell = (): { x: number; y: number } | null => {
      const taken = occupied();
      const head = segments.current[0]!;
      const free: number[] = [];
      for (let i = 0; i < SNAKE_COLS * SNAKE_ROWS; i++) {
        if (taken.has(i)) continue;
        const x = i % SNAKE_COLS;
        const y = Math.floor(i / SNAKE_COLS);
        if (Math.abs(x - head.x) + Math.abs(y - head.y) < SPAWN_CLEARANCE) continue;
        free.push(i);
      }
      if (free.length === 0) return null;
      const i = free[Math.floor(rng.current() * free.length)]!;
      return { x: i % SNAKE_COLS, y: Math.floor(i / SNAKE_COLS) };
    };

    const placeVisitor = () => {
      const cell = freeCell();
      if (!cell) { visitor.current = null; return; }
      const idx = visitors[nextVisitor.current++ % Math.max(1, visitors.length)] ?? 0;
      visitor.current = { ...cell, dex: SNAKE_ROSTER[idx] ?? SNAKE_ROSTER[0]! };
    };

    visitor.current = null;
    placeVisitor();

    const pop = (x: number, y: number, text: string, tone: string) => {
      const layer = popLayer.current;
      if (!layer) return;
      const el = document.createElement("span");
      el.className = `meadow-pop ${tone}`;
      el.textContent = text;
      el.style.left = `${x * CELL + CELL / 2}px`;
      el.style.top = `${y * CELL}px`;
      layer.appendChild(el);
      el.addEventListener("animationend", () => el.remove(), { once: true });
    };

    const tick = () => {
      const segs = segments.current;
      const head = segs[0]!;

      const turn = queued.current.shift();
      if (turn) dir.current = turn;
      const { dx, dy } = DELTA[dir.current];
      const nx = head.x + dx;
      const ny = head.y + dy;

      // The fence is fatal.
      if (nx < 0 || ny < 0 || nx >= SNAKE_COLS || ny >= SNAKE_ROWS) { endRef.current(); return; }

      const onVisitor = visitor.current && visitor.current.x === nx && visitor.current.y === ny;
      const berryIdx = berries.current.findIndex((b) => b.x === nx && b.y === ny);

      // The tail is about to move out of its cell unless the line grows, so it
      // is only a collision when something joins.
      const lastMoving = onVisitor ? segs.length : segs.length - 1;
      for (let i = 0; i < lastMoving; i++) {
        if (segs[i]!.x === nx && segs[i]!.y === ny) { endRef.current(); return; }
      }

      // Everyone steps into the cell ahead of them, and faces the way they went.
      const tail = segs[segs.length - 1]!;
      const tailWas = { x: tail.x, y: tail.y, dir: tail.dir };
      for (let i = segs.length - 1; i > 0; i--) {
        const s = segs[i]!;
        const ahead = segs[i - 1]!;
        s.px = s.x; s.py = s.y;
        s.x = ahead.x; s.y = ahead.y; s.dir = ahead.dir;
      }
      head.px = head.x; head.py = head.y;
      head.x = nx; head.y = ny; head.dir = dir.current;

      if (onVisitor) {
        const joined = visitor.current!;
        segs.push({
          x: tailWas.x, y: tailWas.y, px: tailWas.x, py: tailWas.y, dir: tailWas.dir, dex: joined.dex,
        });
        scoreRef.current += SNAKE_POINTS_POKEMON;
        setScore(scoreRef.current);
        setLength(segs.length);
        pop(nx, ny, `+${SNAKE_POINTS_POKEMON}`, "meadow-pop--join");
        tickMs.current = Math.max(SNAKE_MIN_TICK_MS, tickMs.current - TICK_STEP_MS);
        placeVisitor();
      }

      if (berryIdx >= 0) {
        berries.current.splice(berryIdx, 1);
        scoreRef.current += SNAKE_POINTS_BERRY;
        setScore(scoreRef.current);
        pop(nx, ny, `+${SNAKE_POINTS_BERRY}`, "meadow-pop--berry");
      }
    };

    function paint(progress: number) {
      const line = lineLayer.current;
      if (line) {
        const segs = segments.current;
        while (line.childElementCount < segs.length) {
          const img = document.createElement("img");
          img.className = "pixel meadow-mon";
          img.alt = "";
          img.draggable = false;
          img.style.width = `${SPRITE_BOX}px`;
          img.style.height = `${SPRITE_BOX}px`;
          line.appendChild(img);
        }
        const children = line.children;
        for (let i = 0; i < children.length; i++) {
          const el = children[i] as HTMLImageElement;
          const s = segs[i];
          if (!s) { el.style.display = "none"; continue; }
          el.style.display = "block";

          const face = faceFor(s.dex, s.dir);
          if (el.dataset.src !== face.src) {
            el.dataset.src = face.src;
            el.src = face.src;
          }
          const x = (s.px + (s.x - s.px) * progress) * CELL + CELL / 2 - SPRITE_BOX / 2;
          // Feet on the cell's floor rather than centred: a standing sprite's
          // weight is in its bottom half.
          const y = (s.py + (s.y - s.py) * progress) * CELL + CELL - SPRITE_BOX + 4;
          el.style.transform = `translate3d(${x}px, ${y}px, 0) scaleX(${face.flip ? -1 : 1})`;
          // Painter's order: lower on the board draws on top, the head wins ties.
          el.style.zIndex = String(s.y * 2 + (i === 0 ? 1 : 0));
        }
      }

      const pickups = pickupLayer.current;
      if (pickups) {
        const wanted = 1 + BERRIES_MAX;
        while (pickups.childElementCount < wanted) {
          const img = document.createElement("img");
          img.className = "pixel";
          img.alt = "";
          img.draggable = false;
          pickups.appendChild(img);
        }
        const children = pickups.children;

        const v = children[0] as HTMLImageElement;
        if (visitor.current) {
          const src = frontSrc(visitor.current.dex);
          if (v.dataset.src !== src) {
            v.dataset.src = src;
            v.src = src;
            v.className = "pixel meadow-mon meadow-visitor";
            v.style.width = `${SPRITE_BOX}px`;
            v.style.height = `${SPRITE_BOX}px`;
          }
          v.style.display = "block";
          v.style.left = `${visitor.current.x * CELL + CELL / 2 - SPRITE_BOX / 2}px`;
          v.style.top = `${visitor.current.y * CELL + CELL - SPRITE_BOX + 4}px`;
          v.style.zIndex = String(visitor.current.y * 2);
        } else {
          v.style.display = "none";
        }

        for (let i = 0; i < BERRIES_MAX; i++) {
          const el = children[i + 1] as HTMLImageElement;
          const b = berries.current[i];
          if (!b) { el.style.display = "none"; continue; }
          const src = `/sprites/items/${SNAKE_BERRIES[b.kind] ?? SNAKE_BERRIES[0]}.png`;
          if (el.dataset.src !== src) {
            el.dataset.src = src;
            el.src = src;
            el.className = "pixel meadow-berry";
            el.style.width = `${BERRY_BOX}px`;
            el.style.height = `${BERRY_BOX}px`;
          }
          el.style.display = "block";
          el.style.left = `${b.x * CELL + CELL / 2 - BERRY_BOX / 2}px`;
          el.style.top = `${b.y * CELL + CELL / 2 - BERRY_BOX / 2}px`;
          // Fades over its last stretch, so a vanishing berry is not a surprise.
          const left = BERRY_LIFE_MS - (clock.current - b.bornAt);
          el.style.opacity = left < 1_800 ? String(Math.max(0.2, left / 1_800)) : "1";
        }
      }
    }

    function frame(now: number) {
      if (!running.current) return;
      const dt = Math.min(50, now - lastFrame.current);
      lastFrame.current = now;
      clock.current += dt;

      tickAcc.current += dt;
      while (tickAcc.current >= tickMs.current) {
        tickAcc.current -= tickMs.current;
        tick();
        if (!running.current) return;
      }

      berryAcc.current += dt;
      if (berryAcc.current >= BERRY_EVERY_MS) {
        berryAcc.current -= BERRY_EVERY_MS;
        if (berries.current.length < BERRIES_MAX) {
          const cell = freeCell();
          if (cell) {
            berries.current.push({
              ...cell,
              kind: Math.floor(rng.current() * SNAKE_BERRIES.length),
              bornAt: clock.current,
            });
          }
        }
      }
      berries.current = berries.current.filter((b) => clock.current - b.bornAt < BERRY_LIFE_MS);

      paint(Math.min(1, tickAcc.current / tickMs.current));
      raf.current = requestAnimationFrame(frame);
    }

    paint(0);
    raf.current = requestAnimationFrame(frame);

    return () => {
      running.current = false;
      cancelAnimationFrame(raf.current);
    };
    // Only [status, run] on purpose — anything else is read through a ref, so
    // a mid-run re-render cannot reset the board. `leader` is fixed for a run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, run]);

  const begin = useCallback(async () => {
    setScore(0);
    setLength(1);
    await start();
  }, [start]);

  // Arrows and WASD steer. The arrows must not also scroll the page.
  useEffect(() => {
    const keys: Record<string, Dir> = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      w: "up", s: "down", a: "left", d: "right", W: "up", S: "down", A: "left", D: "right",
    };
    const onKey = (e: KeyboardEvent) => {
      const d = keys[e.key];
      if (!d) return;
      if (!running.current) return;
      e.preventDefault();
      steer(d);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steer]);

  // A hidden tab throttles rAF; end on the spot rather than die unseen.
  useEffect(() => {
    const onHide = () => { if (document.hidden && running.current) end(); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [end]);

  // Swipe to steer on touch. The dominant axis wins; tiny movements are ignored.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    touchStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? "right" : "left");
    else steer(dy > 0 ? "down" : "up");
  };

  return (
    <GameFrame
      name="Pokémon Parade"
      rule="Arrow keys, WASD or swipe. Walk into a wild Pokémon and it joins the line; berries are worth a little extra. The fence and your own line are both fatal."
      status={status}
      error={error}
      result={result}
      palette={palette}
      onStart={begin}
      onAgain={() => { reset(); void begin(); }}
      startLabel="Lead the way"
      stats={status === "playing"
        ? [{ label: "Points", value: String(score) }, { label: "In line", value: String(length) }]
        : []}
    >
      <div
        role="application"
        aria-label="Meadow — steer with the arrow keys or swipe"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        className="playfield playfield--meadow mx-auto w-full"
        style={{ maxWidth: W, aspectRatio: `${W} / ${H}` }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: W, height: H, transform: "scale(var(--field-scale, 1))" }}
        >
          <div className="meadow-grid" aria-hidden="true" />
          <div ref={pickupLayer} className="absolute inset-0" />
          <div ref={lineLayer} className="absolute inset-0" />
          <div ref={popLayer} className="pointer-events-none absolute inset-0" />
        </div>
        <FieldScale width={W} />
      </div>

      {/* A d-pad for anyone without arrow keys. Pointer-down rather than click,
          so a thumb held over the pad steers the moment it lands. */}
      <div className="dpad mx-auto mt-4 sm:hidden" aria-label="Direction pad">
        <button type="button" className="dpad__btn dpad__btn--up" aria-label="Up"
          onPointerDown={(e) => { e.preventDefault(); steer("up"); }}>
          <ArrowUp size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" className="dpad__btn dpad__btn--left" aria-label="Left"
          onPointerDown={(e) => { e.preventDefault(); steer("left"); }}>
          <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" className="dpad__btn dpad__btn--right" aria-label="Right"
          onPointerDown={(e) => { e.preventDefault(); steer("right"); }}>
          <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" className="dpad__btn dpad__btn--down" aria-label="Down"
          onPointerDown={(e) => { e.preventDefault(); steer("down"); }}>
          <ArrowDown size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </GameFrame>
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
