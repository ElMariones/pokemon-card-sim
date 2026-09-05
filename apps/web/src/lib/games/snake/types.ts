export type Direction = "up" | "down" | "left" | "right";

export interface Point { x: number; y: number; }

export type BerryKind = "oran" | "pecha" | "sitrus" | "lum";
export interface Berry extends Point { kind: BerryKind; ttl: number; }
export interface Star extends Point { ttl: number; }
export interface SnakeMember { species: string; shiny: boolean; }
export interface Wild extends SnakeMember, Point {}
export type SnakeStatus = "idle" | "running" | "paused" | "over";

export type GameEvent =
  | { type: "caught"; species: string; shiny: boolean; points: number }
  | { type: "berry"; kind: BerryKind; points: number }
  | { type: "star" }
  | { type: "crash"; reason: "wall" | "self" };

export interface SnakeState {
  cols: number;
  rows: number;
  /** body[0] is the head; party[i] owns body[i]. */
  body: Point[];
  party: SnakeMember[];
  dir: Direction;
  queued: Direction[];
  wild: Wild;
  berry: Berry | null;
  star: Star | null;
  /** The next wild spawned after a catch will be shiny. */
  shinyPending: boolean;
  score: number;
  ticks: number;
  status: SnakeStatus;
  seed: number;
  lastEvent: GameEvent | null;
}
