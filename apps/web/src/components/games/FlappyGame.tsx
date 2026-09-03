"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boundsHeight, boundsWidth, mirrorBounds } from "@pcs/minigame-engine";
import { useMinigameRun } from "./useMinigameRun";
import { useSpriteBounds, type SpriteMeasurement } from "./useSpriteBounds";
import { GameFrame } from "./GameFrame";

/**
 * Flappy Pokémon.
 *
 * Rendered in the DOM with a requestAnimationFrame loop rather than on a
 * canvas, and that is not a stylistic choice: the sprites are animated GIFs,
 * and canvas drawImage paints only their first frame. On a canvas the player
 * would fly a dead sprite.
 *
 * The obstacles are stacked booster boxes with a Poké Ball on the cap, flying
 * over a Route: a ridge line, a tree line and a grass verge, each scrolling at
 * its own speed so the field has depth. Gap centres come from the run's seed,
 * so the level is the server's rather than the browser's.
 *
 * Every constant below sits comfortably inside the plausibility ceiling the
 * server checks: obstacles arrive every 1500ms at the fastest, against a floor
 * of 700ms, so honest play is never refused.
 */

const W = 720;
const H = 460;
/**
 * The top of the grass verge: the floor the player dies on, and the line every
 * obstacle stands on. The CSS draws the verge from this same y — see
 * `.route-ground` in arcade.css, which is the one place the two have to agree.
 */
const FLOOR = 414;

const GRAVITY = 1_700;       // px per second squared
const FLAP = -470;           // px per second, applied instantly
const SCROLL = 168;          // px per second
const SPAWN_MS = 1_500;
const STACK_W = 62;
const BIRD_X = 150;

/**
 * How large the Pokémon itself is drawn — the animal, not its image.
 *
 * The sprite sheet's 96px box is mostly empty, and how much of it each species
 * fills varies wildly. Sizing to the measured body instead means Pidgey and
 * Rayquaza look like they belong in the same game and, more importantly, fly
 * the same difficulty.
 */
const BIRD_BODY = 46;

/**
 * How much of the measured body the hitbox keeps.
 *
 * Even a tight box is generous around a wing or a tail, and a near miss should
 * read as a near miss. Trimming a little is what makes the collision agree with
 * what the player saw.
 */
const HITBOX_FORGIVENESS = 0.86;

const GAP_START = 190;
const GAP_MIN = 138;
/** How many obstacles it takes to reach the tightest gap. */
const GAP_TIGHTEN_OVER = 30;
/** Keeps a gap fully on screen however the seed fell. */
const GAP_MARGIN = 78;

const gapFor = (score: number) =>
  Math.max(GAP_MIN, GAP_START - (GAP_START - GAP_MIN) * (score / GAP_TIGHTEN_OVER));

interface Obstacle {
  x: number;
  /** Gap centre in pixels. */
  centre: number;
  gap: number;
  passed: boolean;
}

/** Everything the loop and the renderer need to know about the equipped body. */
interface BirdGeometry {
  /** The <img> box, at the sprite's own aspect ratio so nothing is stretched. */
  imageW: number;
  imageH: number;
  hitW: number;
  hitH: number;
  /** Body centre within the image box, 0..1, after mirroring. */
  cx: number;
  cy: number;
}

function geometryFor(sprite: SpriteMeasurement): BirdGeometry {
  // The sprite is drawn mirrored so it faces the way it is travelling, which
  // moves the body within its box — so the hitbox has to be mirrored with it.
  const m = mirrorBounds(sprite.bounds);
  const bw = boundsWidth(m);
  const bh = boundsHeight(m);

  // Scale the whole frame, not each axis: these frames are not square, and
  // fitting one into a square box is what stretches Gyarados.
  const scale = BIRD_BODY / Math.max(bw * sprite.width, bh * sprite.height, 1);
  const imageW = sprite.width * scale;
  const imageH = sprite.height * scale;

  return {
    imageW,
    imageH,
    hitW: bw * imageW * HITBOX_FORGIVENESS,
    hitH: bh * imageH * HITBOX_FORGIVENESS,
    cx: (m.x0 + m.x1) / 2,
    cy: (m.y0 + m.y1) / 2,
  };
}

export function FlappyGame() {
  const { status, run, result, error, start, settle, reset } = useMinigameRun("flappy");
  const [score, setScore] = useState(0);

  const birdRef = useRef<HTMLSpanElement>(null);
  const obstacleLayer = useRef<HTMLDivElement>(null);

  // Simulation state lives in refs, not state: the loop runs every frame, and
  // re-rendering React sixty times a second would be the whole frame budget.
  // `y` is the centre of the bird's body, not the corner of its image — the
  // image's corner moves when the equipped sprite changes and the body's
  // centre does not.
  const y = useRef(FLOOR / 2);
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

  const measurement = useSpriteBounds(`/sprites/pokemon/${sprite}.gif`);
  const bird = useMemo(() => geometryFor(measurement), [measurement]);

  // The measurement resolves a frame or two into the run, so the loop reads it
  // through a ref rather than closing over it.
  const geomRef = useRef(bird);
  useEffect(() => { geomRef.current = bird; }, [bird]);

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

    y.current = FLOOR / 2;
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

      const { hitW, hitH, cx, cy, imageW, imageH } = geomRef.current;

      vy.current += GRAVITY * dt;
      y.current += vy.current * dt;

      spawnAcc.current += dt * 1000;
      if (spawnAcc.current >= SPAWN_MS) {
        spawnAcc.current -= SPAWN_MS;
        const i = nextIndex.current++;
        const fraction = seededGaps[i % seededGaps.length] ?? 0.5;
        obstacles.current.push({
          x: W,
          centre: Math.min(FLOOR - GAP_MARGIN, Math.max(GAP_MARGIN, fraction * FLOOR)),
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

      const top = y.current - hitH / 2;
      const bottom = y.current + hitH / 2;
      const left = BIRD_X - hitW / 2;
      const right = BIRD_X + hitW / 2;

      // The ceiling and the grass are both fatal, so there is no corner to
      // park in.
      if (top < 0 || bottom > FLOOR) {
        endRef.current();
        return;
      }

      for (const o of obstacles.current) {
        if (right <= o.x || left >= o.x + STACK_W) continue;
        if (top < o.centre - o.gap / 2 || bottom > o.centre + o.gap / 2) {
          endRef.current();
          return;
        }
      }

      // Paint by writing transforms directly, bypassing React entirely.
      if (birdRef.current) {
        const tilt = Math.max(-24, Math.min(70, vy.current * 0.06));
        // Place the image so the *body's* centre lands on (BIRD_X, y). The
        // element's transform-origin is that same point, so the tilt pivots
        // around the animal rather than around the empty box holding it.
        birdRef.current.style.transform =
          `translate3d(${BIRD_X - cx * imageW}px, ${y.current - cy * imageH}px, 0)` +
          ` rotate(${tilt}deg)`;
      }

      const layer = obstacleLayer.current;
      if (layer) {
        // Two nodes per obstacle, reused by index rather than recreated each
        // frame — churning the DOM at 60fps is what makes these feel cheap.
        while (layer.childElementCount < obstacles.current.length * 2) {
          const el = document.createElement("span");
          el.className = layer.childElementCount % 2 === 0
            ? "stack stack--top"
            : "stack stack--bottom";
          layer.appendChild(el);
        }
        const children = layer.children;
        for (let n = 0; n < children.length; n++) {
          (children[n] as HTMLElement).style.display = "none";
        }
        obstacles.current.forEach((o, idx) => {
          const above = children[idx * 2] as HTMLElement | undefined;
          const below = children[idx * 2 + 1] as HTMLElement | undefined;
          const gapTop = o.centre - o.gap / 2;
          const gapBottom = o.centre + o.gap / 2;
          if (above) {
            above.style.display = "block";
            above.style.width = `${STACK_W}px`;
            above.style.height = `${Math.max(0, gapTop)}px`;
            above.style.transform = `translate3d(${o.x}px, 0, 0)`;
          }
          if (below) {
            below.style.display = "block";
            below.style.width = `${STACK_W}px`;
            below.style.height = `${Math.max(0, FLOOR - gapBottom)}px`;
            below.style.transform = `translate3d(${o.x}px, ${gapBottom}px, 0)`;
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
      rule="Click, tap or press Space to flap. The ceiling and the grass are both fatal."
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
        className="playfield playfield--route mx-auto w-full cursor-pointer"
        style={{ maxWidth: W, aspectRatio: `${W} / ${H}` }}
      >
        {/* A fixed internal coordinate space, scaled to whatever width the
            element gets, so the physics never has to care about the viewport
            and the difficulty is identical on a phone and on a desktop. */}
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: W, height: H, transform: "scale(var(--field-scale, 1))" }}
        >
          {/* The Route, back to front. Each layer scrolls at its own speed, so
              the ridge crawls, the trees walk and the grass keeps pace exactly
              with the obstacles standing on it. */}
          <div className="route-sun" aria-hidden="true" />
          <div className="route-clouds" aria-hidden="true" />
          <div className="route-ridge" aria-hidden="true" />
          <div className="route-trees" aria-hidden="true" />

          <div ref={obstacleLayer} className="absolute inset-0" />

          <div className="route-ground" aria-hidden="true" />

          <span
            ref={birdRef}
            className="absolute left-0 top-0 block will-change-transform"
            style={{
              width: bird.imageW,
              height: bird.imageH,
              transformOrigin: `${bird.cx * 100}% ${bird.cy * 100}%`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/sprites/pokemon/${sprite}.gif`}
              alt=""
              // Front sprites are drawn facing left, towards the trainer. This
              // one is flying right, so it is mirrored — about the image box's
              // own centre, which is exactly what mirrorBounds models.
              className="pixel h-full w-full -scale-x-100"
            />
          </span>
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
