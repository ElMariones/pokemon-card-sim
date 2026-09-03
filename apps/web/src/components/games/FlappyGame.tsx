"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMinigameRun } from "./useMinigameRun";
import { GameFrame } from "./GameFrame";

/**
 * Flappy Pokémon.
 *
 * Rendered in the DOM with a requestAnimationFrame loop rather than on a
 * canvas, and that is not a stylistic choice: the sprites are animated GIFs,
 * and canvas drawImage paints only their first frame. On a canvas the player
 * would fly a dead sprite.
 *
 * The obstacles are stacked booster boxes. Gap centres come from the run's
 * seed, so the level is the server's rather than the browser's.
 *
 * Every constant below sits comfortably inside the plausibility ceiling the
 * server checks: obstacles arrive every 1500ms at the fastest, against a floor
 * of 700ms, so honest play is never refused.
 */

const W = 720;
const H = 460;

const GRAVITY = 1_700;       // px per second squared
const FLAP = -470;           // px per second, applied instantly
const SCROLL = 168;          // px per second
const SPAWN_MS = 1_500;
const STACK_W = 62;
const BIRD_X = 150;
const BIRD_SIZE = 46;

const GAP_START = 190;
const GAP_MIN = 140;
/** How many obstacles it takes to reach the tightest gap. */
const GAP_TIGHTEN_OVER = 30;

const gapFor = (score: number) =>
  Math.max(GAP_MIN, GAP_START - (GAP_START - GAP_MIN) * (score / GAP_TIGHTEN_OVER));

interface Obstacle {
  x: number;
  /** Gap centre in pixels. */
  centre: number;
  gap: number;
  passed: boolean;
}

export function FlappyGame() {
  const { status, run, result, error, start, settle, reset } = useMinigameRun("flappy");
  const [score, setScore] = useState(0);

  const birdRef = useRef<HTMLImageElement>(null);
  const obstacleLayer = useRef<HTMLDivElement>(null);

  // Simulation state lives in refs, not state: the loop runs every frame, and
  // re-rendering React sixty times a second would be the whole frame budget.
  const y = useRef(H / 2);
  const vy = useRef(0);
  const obstacles = useRef<Obstacle[]>([]);
  const spawnAcc = useRef(0);
  const nextIndex = useRef(0);
  const scoreRef = useRef(0);
  const running = useRef(false);
  const raf = useRef<number>(0);
  const lastFrame = useRef(0);

  const sprite = run?.equipped.sprite ?? 16;
  const palette = run?.equipped.palette ?? ["#c8a870", "#6d5a3a"];

  const end = useCallback(() => {
    if (!running.current) return;
    running.current = false;
    cancelAnimationFrame(raf.current);
    void settle(scoreRef.current);
  }, [settle]);

  // The loop reaches `end` through a ref so its effect can depend on nothing
  // but the run itself. See the note on the loop's dependency array.
  const endRef = useRef(end);
  useEffect(() => { endRef.current = end; }, [end]);

  const flap = useCallback(() => {
    if (!running.current) return;
    vy.current = FLAP;
  }, []);

  /**
   * The loop lives in an effect rather than in a callback.
   *
   * A requestAnimationFrame loop has to schedule itself, and a `useCallback`
   * cannot reference the binding it is in the middle of defining. Owning it
   * here makes `frame` an ordinary hoisted function that can name itself, and
   * puts the teardown that cancels the pending frame beside the code that
   * scheduled it.
   */
  useEffect(() => {
    if (status !== "playing" || !run) return;

    y.current = H / 2;
    vy.current = 0;
    obstacles.current = [];
    spawnAcc.current = 0;
    nextIndex.current = 0;
    scoreRef.current = 0;
    running.current = true;
    lastFrame.current = performance.now();

    const seededGaps = run.content.kind === "flappy" ? run.content.gaps : [];

    function frame(now: number) {
      if (!running.current) return;

      // A delta clamped to 50ms. A slow frame would otherwise teleport the
      // player straight through an obstacle on the next tick.
      const dt = Math.min(0.05, (now - lastFrame.current) / 1000);
      lastFrame.current = now;

      vy.current += GRAVITY * dt;
      y.current += vy.current * dt;

      spawnAcc.current += dt * 1000;
      if (spawnAcc.current >= SPAWN_MS) {
        spawnAcc.current -= SPAWN_MS;
        const i = nextIndex.current++;
        const fraction = seededGaps[i % seededGaps.length] ?? 0.5;
        obstacles.current.push({
          x: W,
          // Keep the gap fully on screen however the seed fell.
          centre: Math.min(H - 90, Math.max(90, fraction * H)),
          gap: gapFor(scoreRef.current),
          passed: false,
        });
      }

      for (const o of obstacles.current) {
        o.x -= SCROLL * dt;
        if (!o.passed && o.x + STACK_W < BIRD_X) {
          o.passed = true;
          scoreRef.current += 1;
          setScore(scoreRef.current);
        }
      }
      obstacles.current = obstacles.current.filter((o) => o.x > -STACK_W - 20);

      // Floor and ceiling are both fatal, so there is no corner to park in.
      if (y.current < 0 || y.current + BIRD_SIZE > H) {
        endRef.current();
        return;
      }

      for (const o of obstacles.current) {
        const overlapsX = BIRD_X + BIRD_SIZE > o.x && BIRD_X < o.x + STACK_W;
        if (!overlapsX) continue;
        const top = o.centre - o.gap / 2;
        const bottom = o.centre + o.gap / 2;
        if (y.current < top || y.current + BIRD_SIZE > bottom) {
          endRef.current();
          return;
        }
      }

      // Paint by writing transforms directly, bypassing React entirely.
      if (birdRef.current) {
        const tilt = Math.max(-24, Math.min(70, vy.current * 0.06));
        birdRef.current.style.transform =
          `translate3d(${BIRD_X}px, ${y.current}px, 0) rotate(${tilt}deg)`;
      }

      const layer = obstacleLayer.current;
      if (layer) {
        // Two nodes per obstacle, reused by index rather than recreated each
        // frame — churning the DOM at 60fps is what makes these feel cheap.
        while (layer.childElementCount < obstacles.current.length * 2) {
          const el = document.createElement("span");
          el.className = "stack";
          layer.appendChild(el);
        }
        const children = layer.children;
        for (let n = 0; n < children.length; n++) {
          (children[n] as HTMLElement).style.display = "none";
        }
        obstacles.current.forEach((o, idx) => {
          const top = children[idx * 2] as HTMLElement | undefined;
          const bottom = children[idx * 2 + 1] as HTMLElement | undefined;
          const gapTop = o.centre - o.gap / 2;
          const gapBottom = o.centre + o.gap / 2;
          if (top) {
            top.style.display = "block";
            top.style.width = `${STACK_W}px`;
            top.style.height = `${Math.max(0, gapTop)}px`;
            top.style.transform = `translate3d(${o.x}px, 0, 0)`;
          }
          if (bottom) {
            bottom.style.display = "block";
            bottom.style.width = `${STACK_W}px`;
            bottom.style.height = `${Math.max(0, H - gapBottom)}px`;
            bottom.style.transform = `translate3d(${o.x}px, ${gapBottom}px, 0)`;
          }
        });
      }

      raf.current = requestAnimationFrame(frame);
    }

    raf.current = requestAnimationFrame(frame);

    return () => {
      running.current = false;
      cancelAnimationFrame(raf.current);
    };
    // Deliberately only [status, run]. Everything else the loop needs is read
    // through a ref, because a dependency whose identity changed mid-run would
    // re-run this effect — and re-running it resets the playfield, teleporting
    // the player back to the middle of the screen mid-flight.
  }, [status, run]);

  const begin = useCallback(async () => {
    setScore(0);
    await start();
  }, [start]);

  // Space, click and tap all flap. Space must not also scroll the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      e.preventDefault();
      flap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flap]);

  /**
   * A hidden tab throttles rAF to roughly once a second. Left running, the
   * player would come back to a death they never saw, so the run ends on the
   * spot and pays out whatever it had already earned.
   */
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && running.current) end();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [end]);

  return (
    <GameFrame
      name="Flappy Pokémon"
      rule="Click, tap or press Space to flap. The floor and the ceiling are both fatal."
      status={status}
      error={error}
      result={result}
      palette={palette}
      onStart={begin}
      onAgain={() => { reset(); void begin(); }}
      startLabel="Take off"
      stats={status === "playing" ? [{ label: "Cleared", value: String(score) }] : []}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label="Playfield — click or press Space to flap"
        onPointerDown={(e) => { e.preventDefault(); flap(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); flap(); }
        }}
        className="playfield mx-auto w-full cursor-pointer"
        style={{ maxWidth: W, aspectRatio: `${W} / ${H}` }}
      >
        {/* A fixed internal coordinate space, scaled to whatever width the
            element gets, so the physics never has to care about the viewport
            and the difficulty is identical on a phone and on a desktop. */}
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: W, height: H, transform: "scale(var(--field-scale, 1))" }}
        >
          <div ref={obstacleLayer} className="absolute inset-0" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={birdRef}
            src={`/sprites/pokemon/${sprite}.gif`}
            alt=""
            width={BIRD_SIZE}
            height={BIRD_SIZE}
            className="pixel absolute left-0 top-0 will-change-transform"
            style={{ width: BIRD_SIZE, height: BIRD_SIZE }}
          />
        </div>

        <FieldScale width={W} />
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
