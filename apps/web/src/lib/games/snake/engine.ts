import {
  BASE_TICK_MS, BERRIES, BERRY_SPAWN_CHANCE, COLS, DIR_VECTORS, MAX_QUEUED_INPUTS,
  MIN_TICK_MS, OPPOSITE, ROWS, SHINY_WILD_POINTS, SPEEDUP_PER_SEGMENT_MS,
  STAR_SPAWN_CHANCE, STAR_TTL, WILD_POINTS, WILD_POOL,
} from "./constants";
import { rand, randInt } from "./rng";
import type { Berry, BerryKind, Direction, Point, SnakeState, Star, Wild } from "./types";

const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

function freeCells(
  state: Pick<SnakeState, "cols" | "rows" | "body" | "wild" | "berry" | "star">,
  includeWild = true,
): Point[] {
  const taken = new Set(state.body.map((p) => `${p.x},${p.y}`));
  if (includeWild) taken.add(`${state.wild.x},${state.wild.y}`);
  if (state.berry) taken.add(`${state.berry.x},${state.berry.y}`);
  if (state.star) taken.add(`${state.star.x},${state.star.y}`);
  const cells: Point[] = [];
  for (let y = 0; y < state.rows; y++) for (let x = 0; x < state.cols; x++) {
    if (!taken.has(`${x},${y}`)) cells.push({ x, y });
  }
  return cells;
}

function spawnWild(state: SnakeState, seed: number, shiny = false): { wild: Wild; seed: number } {
  // Do not reserve the previous wild's cell: it has just been caught.
  const cells = freeCells({ ...state, wild: { x: -1, y: -1, species: "", shiny: false } }, false);
  const cellPick = randInt(seed, cells.length);
  const speciesPick = randInt(cellPick.seed, WILD_POOL.length);
  return {
    wild: { ...(cells[cellPick.value] ?? { x: 0, y: 0 }), species: WILD_POOL[speciesPick.value]!, shiny },
    seed: speciesPick.seed,
  };
}

function maybeSpawnStar(state: SnakeState, seed: number): { star: Star | null; seed: number } {
  if (state.star || state.shinyPending || state.wild.shiny) return { star: state.star, seed };
  const roll = rand(seed);
  if (roll.value > STAR_SPAWN_CHANCE) return { star: null, seed: roll.seed };
  const cells = freeCells(state);
  if (cells.length === 0) return { star: null, seed: roll.seed };
  const cellPick = randInt(roll.seed, cells.length);
  return { star: { ...cells[cellPick.value]!, ttl: STAR_TTL }, seed: cellPick.seed };
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
    cols, rows, body: [{ x: Math.floor(cols / 2), y: Math.floor(rows / 2) }],
    party: [{ species: "pikachu", shiny: false }],
    dir: "right", queued: [], wild: { x: -1, y: -1, species: "bulbasaur", shiny: false }, berry: null,
    star: null, shinyPending: false,
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
  const ateStar = state.star !== null && samePoint(newHead, state.star);
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
  let star = state.star;
  let shinyPending = state.shinyPending;
  let lastEvent: SnakeState["lastEvent"] = null;
  if (caught) {
    const points = state.wild.shiny ? SHINY_WILD_POINTS : WILD_POINTS;
    party = [...party, { species: state.wild.species, shiny: state.wild.shiny }];
    score += points;
    lastEvent = { type: "caught", species: state.wild.species, shiny: state.wild.shiny, points };
  } else body = body.slice(0, -1);
  if (ateBerry && berry) {
    score += BERRIES[berry.kind].points;
    lastEvent = { type: "berry", kind: berry.kind, points: BERRIES[berry.kind].points };
    berry = null;
  }
  if (ateStar) {
    shinyPending = true;
    star = null;
    lastEvent = { type: "star" };
  }

  const moved: SnakeState = { ...state, body, party, dir, queued, score, wild, berry, star, shinyPending };
  if (caught) {
    ({ wild, seed } = spawnWild(moved, seed, shinyPending));
    if (shinyPending) shinyPending = false;
  }
  if (berry) berry = berry.ttl <= 1 ? null : { ...berry, ttl: berry.ttl - 1 };
  if (star) star = star.ttl <= 1 ? null : { ...star, ttl: star.ttl - 1 };
  ({ berry, seed } = maybeSpawnBerry({ ...moved, wild, berry, star, shinyPending }, seed));
  ({ star, seed } = maybeSpawnStar({ ...moved, wild, berry, star, shinyPending }, seed));
  return { ...moved, wild, berry, star, shinyPending, seed, ticks: state.ticks + 1, lastEvent };
}
