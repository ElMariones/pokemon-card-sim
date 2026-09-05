export type Direction = "up" | "down" | "left" | "right";

export interface Point { x: number; y: number; }

export type BerryKind = "oran" | "pecha" | "sitrus" | "lum";
export interface Berry extends Point { kind: BerryKind; ttl: number; }
export interface Wild extends Point { species: string; }
export type SnakeStatus = "idle" | "running" | "paused" | "over";

export type GameEvent =
  | { type: "caught"; species: string; points: number }
  | { type: "berry"; kind: BerryKind; points: number }
  | { type: "crash"; reason: "wall" | "self" };

export interface SnakeState {
  cols: number;
  rows: number;
  /** body[0] is the head; party[i] owns body[i]. */
  body: Point[];
  party: string[];
  dir: Direction;
  queued: Direction[];
  wild: Wild;
  berry: Berry | null;
  score: number;
  ticks: number;
  status: SnakeStatus;
  seed: number;
  lastEvent: GameEvent | null;
}
