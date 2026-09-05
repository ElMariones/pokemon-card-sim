import {
  BASE_TICK_MS, BERRIES, BERRY_SPAWN_CHANCE, COLS, DIR_VECTORS, MAX_QUEUED_INPUTS,
  MIN_TICK_MS, OPPOSITE, ROWS, SPEEDUP_PER_SEGMENT_MS, WILD_POINTS, WILD_POOL,
} from "./constants";
import { rand, randInt } from "./rng";
import type { Berry, BerryKind, Direction, Point, SnakeState, Wild } from "./types";

const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

function freeCells(
  state: Pick<SnakeState, "cols" | "rows" | "body" | "wild" | "berry">,
  includeWild = true,
): Point[] {
  const taken = new Set(state.body.map((p) => `${p.x},${p.y}`));
  if (includeWild) taken.add(`${state.wild.x},${state.wild.y}`);
  if (state.berry) taken.add(`${state.berry.x},${state.berry.y}`);
  const cells: Point[] = [];
  for (let y = 0; y < state.rows; y++) for (let x = 0; x < state.cols; x++) {
    if (!taken.has(`${x},${y}`)) cells.push({ x, y });
  }
  return cells;
}

function spawnWild(state: SnakeState, seed: number): { wild: Wild; seed: number } {
  // Do not reserve the previous wild's cell: it has just been caught.
  const cells = freeCells({ ...state, wild: { x: -1, y: -1, species: "" } }, false);
  const cellPick = randInt(seed, cells.length);
  const speciesPick = randInt(cellPick.seed, WILD_POOL.length);
  return {
    wild: { ...(cells[cellPick.value] ?? { x: 0, y: 0 }), species: WILD_POOL[speciesPick.value]! },
    seed: speciesPick.seed,
  };
}

function pickBerryKind(seed: number): { kind: BerryKind; seed: number } {
  const kinds = Object.keys(BERRIES) as BerryKind[];
  const roll = rand(seed);
  let cursor = 0;
  for (const kind of kinds) {
    cursor += BERRIES[kind].weight;
    if (roll.value * 100 < cursor) return { kind, seed: roll.seed };
  }
  return { kind: "oran", seed: roll.seed };
}

function maybeSpawnBerry(state: SnakeState, seed: number): { berry: Berry | null; seed: number } {
  if (state.berry) return { berry: state.berry, seed };
  const roll = rand(seed);
  if (roll.value > BERRY_SPAWN_CHANCE) return { berry: null, seed: roll.seed };
  const cells = freeCells(state);
  if (cells.length === 0) return { berry: null, seed: roll.seed };
  const cellPick = randInt(roll.seed, cells.length);
  const kindPick = pickBerryKind(cellPick.seed);
  return {
    berry: { ...cells[cellPick.value]!, kind: kindPick.kind, ttl: BERRIES[kindPick.kind].ttl },
    seed: kindPick.seed,
  };
}

export function tickMsFor(length: number): number {
  return Math.max(MIN_TICK_MS, BASE_TICK_MS - (length - 1) * SPEEDUP_PER_SEGMENT_MS);
}

export function createInitialState(seed: number, cols = COLS, rows = ROWS): SnakeState {
  const base: SnakeState = {
    cols, rows, body: [{ x: Math.floor(cols / 2), y: Math.floor(rows / 2) }], party: ["pikachu"],
    dir: "right", queued: [], wild: { x: -1, y: -1, species: "bulbasaur" }, berry: null,
    score: 0, ticks: 0, status: "idle", seed, lastEvent: null,
  };
  const spawned = spawnWild(base, seed);
  return { ...base, wild: spawned.wild, seed: spawned.seed };
}

export function queueDirection(state: SnakeState, dir: Direction): SnakeState {
  if (state.status === "over") return state;
  const last = state.queued.at(-1) ?? state.dir;
  if (dir === last || dir === OPPOSITE[last] || state.queued.length >= MAX_QUEUED_INPUTS) return state;
  return { ...state, queued: [...state.queued, dir] };
}
export const start = (state: SnakeState): SnakeState =>
  state.status === "idle" || state.status === "paused" ? { ...state, status: "running", lastEvent: null } : state;
export const pause = (state: SnakeState): SnakeState =>
  state.status === "running" ? { ...state, status: "paused" } : state;

export function facingOf(state: Pick<SnakeState, "body" | "dir">, index: number): Direction {
  if (index === 0) return state.dir;
  const me = state.body[index]!;
  const ahead = state.body[index - 1]!;
  if (ahead.x > me.x) return "right";
  if (ahead.x < me.x) return "left";
  return ahead.y > me.y ? "down" : "up";
}

export function step(state: SnakeState): SnakeState {
  if (state.status !== "running") return state;
  const [queuedDir, ...queued] = state.queued;
  const dir = queuedDir ?? state.dir;
  const head = state.body[0]!;
  const vector = DIR_VECTORS[dir];
  const newHead = { x: head.x + vector.x, y: head.y + vector.y };
  if (newHead.x < 0 || newHead.y < 0 || newHead.x >= state.cols || newHead.y >= state.rows) {
    return { ...state, dir, queued: [], status: "over", lastEvent: { type: "crash", reason: "wall" } };
  }
  const caught = samePoint(newHead, state.wild);
  const ateBerry = state.berry !== null && samePoint(newHead, state.berry);
  const collidable = caught ? state.body : state.body.slice(0, -1);
  if (collidable.some((point) => samePoint(point, newHead))) {
    return { ...state, dir, queued: [], status: "over", lastEvent: { type: "crash", reason: "self" } };
  }

  let body = [newHead, ...state.body];
  let party = state.party;
  let score = state.score;
  let seed = state.seed;
  let wild = state.wild;
  let berry = state.berry;
  let lastEvent: SnakeState["lastEvent"] = null;
  if (caught) {
    party = [...party, state.wild.species];
    score += WILD_POINTS;
    lastEvent = { type: "caught", species: state.wild.species, points: WILD_POINTS };
  } else body = body.slice(0, -1);
  if (ateBerry && berry) {
    score += BERRIES[berry.kind].points;
    lastEvent = { type: "berry", kind: berry.kind, points: BERRIES[berry.kind].points };
    berry = null;
  }

  const moved: SnakeState = { ...state, body, party, dir, queued, score, wild, berry };
  if (caught) ({ wild, seed } = spawnWild(moved, seed));
  if (berry) berry = berry.ttl <= 1 ? null : { ...berry, ttl: berry.ttl - 1 };
  ({ berry, seed } = maybeSpawnBerry({ ...moved, wild, berry }, seed));
  return { ...moved, wild, berry, seed, ticks: state.ticks + 1, lastEvent };
}
