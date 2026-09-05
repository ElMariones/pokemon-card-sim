import { describe, expect, it } from "vitest";
import { BERRIES, MIN_TICK_MS, SHINY_WILD_POINTS, WILD_POINTS } from "../apps/web/src/lib/games/snake/constants";
import { createInitialState, facingOf, queueDirection, start, step, tickMsFor } from "../apps/web/src/lib/games/snake/engine";
import type { SnakeState } from "../apps/web/src/lib/games/snake/types";

const running = (seed = 42) => start(createInitialState(seed));

describe("PokéSnake engine", () => {
  it("is deterministic for its seed and starts with Pikachu", () => {
    const first = createInitialState(7);
    const second = createInitialState(7);
    expect(first).toEqual(second);
    expect(first.party).toEqual([{ species: "pikachu", shiny: false }]);
    expect(step(start(first))).toEqual(step(start(second)));
  });

  it("ignores reversals, retains two fast turns, and advances one cell", () => {
    let state = running();
    state = queueDirection(state, "left");
    expect(state.queued).toEqual([]);
    state = queueDirection(queueDirection(queueDirection(state, "up"), "left"), "down");
    expect(state.queued).toEqual(["up", "left"]);
    expect(step(running()).body[0]).toEqual({ x: 11, y: 8 });
  });

  it("recruits a caught wild Pokémon at the end of the party", () => {
    const state = { ...running(), wild: { x: 11, y: 8, species: "charmander", shiny: false } };
    const next = step(state);
    expect(next.body).toHaveLength(2);
    expect(next.party).toEqual([
      { species: "pikachu", shiny: false },
      { species: "charmander", shiny: false },
    ]);
    expect(next.score).toBe(WILD_POINTS);
    expect(next.lastEvent).toEqual({ type: "caught", species: "charmander", shiny: false, points: WILD_POINTS });
    expect(next.body.some((point) => point.x === next.wild.x && point.y === next.wild.y)).toBe(false);
  });

  it("awards berries without growing and allows the tail cell to be vacated", () => {
    const berryRun = { ...running(), berry: { x: 11, y: 8, kind: "sitrus" as const, ttl: 10 } };
    const berryNext = step(berryRun);
    expect(berryNext.body).toHaveLength(1);
    expect(berryNext.score).toBe(BERRIES.sitrus.points);

    const base = running();
    const loop: SnakeState = {
      ...base, dir: "up", wild: { x: 10, y: 10, species: "pidgey", shiny: false },
      body: [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
      party: ["pikachu", "a", "b", "c"].map((species) => ({ species, shiny: false })),
    };
    expect(step(loop).status).toBe("running");
  });

  it("faces segments towards the Pokémon ahead and reaches a speed floor", () => {
    const state: Pick<SnakeState, "body" | "dir"> = {
      dir: "up", body: [{ x: 5, y: 3 }, { x: 5, y: 4 }, { x: 6, y: 4 }],
    };
    expect(facingOf(state, 0)).toBe("up");
    expect(facingOf(state, 1)).toBe("up");
    expect(facingOf(state, 2)).toBe("left");
    expect(tickMsFor(500)).toBe(MIN_TICK_MS);
  });

  it("preserves party/body invariants in seeded simulations", () => {
    const directions = ["up", "down", "left", "right"] as const;
    for (let seed = 1; seed <= 30; seed++) {
      let state = running(seed);
      for (let tick = 0; tick < 1_000 && state.status === "running"; tick++) {
        if (tick % 3 === 0) state = queueDirection(state, directions[(seed + tick) % directions.length]!);
        state = step(state);
        expect(state.party).toHaveLength(state.body.length);
        expect(state.party[0]).toEqual({ species: "pikachu", shiny: false });
        expect(new Set(state.body.map((point) => `${point.x},${point.y}`)).size).toBe(state.body.length);
      }
    }
  });

  it("uses a collected star on the next spawned wild and preserves its shiny form", () => {
    let state: SnakeState = {
      ...running(),
      wild: { x: 2, y: 2, species: "pidgey", shiny: false },
      star: { x: 11, y: 8, ttl: 20 },
    };
    state = step(state);
    expect(state.shinyPending).toBe(true);
    expect(state.lastEvent).toEqual({ type: "star" });

    state = { ...state, wild: { x: 12, y: 8, species: "charmander", shiny: false } };
    state = step(state);
    expect(state.wild.shiny).toBe(true);
    expect(state.shinyPending).toBe(false);

    state = { ...state, wild: { ...state.wild, x: 13, y: 8 } };
    state = step(state);
    expect(state.lastEvent).toMatchObject({ type: "caught", shiny: true, points: SHINY_WILD_POINTS });
    expect(state.party.at(-1)?.shiny).toBe(true);
  });
});
