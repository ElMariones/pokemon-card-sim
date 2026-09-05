import type { BerryKind, Direction, Point } from "./types";

export const COLS = 20;
export const ROWS = 16;
export const BASE_TICK_MS = 170;
export const MIN_TICK_MS = 75;
export const SPEEDUP_PER_SEGMENT_MS = 4;
export const WILD_POINTS = 10;
export const BERRY_SPAWN_CHANCE = 0.06;
export const MAX_QUEUED_INPUTS = 2;

export const DIR_VECTORS: Record<Direction, Point> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};
export const OPPOSITE: Record<Direction, Direction> = {
  up: "down", down: "up", left: "right", right: "left",
};
export const BERRIES: Record<BerryKind, { points: number; ttl: number; weight: number; label: string }> = {
  oran: { points: 5, ttl: 60, weight: 50, label: "Oran Berry" },
  pecha: { points: 10, ttl: 45, weight: 30, label: "Pecha Berry" },
  sitrus: { points: 20, ttl: 30, weight: 15, label: "Sitrus Berry" },
  lum: { points: 40, ttl: 20, weight: 5, label: "Lum Berry" },
};

export const WILD_POOL = [
  "bulbasaur", "charmander", "squirtle", "caterpie", "pidgey", "rattata", "ekans", "sandshrew",
  "nidoranf", "clefairy", "vulpix", "jigglypuff", "zubat", "oddish", "paras", "diglett", "meowth",
  "psyduck", "mankey", "growlithe", "poliwag", "abra", "machop", "bellsprout", "tentacool", "geodude",
  "ponyta", "slowpoke", "magnemite", "doduo", "seel", "grimer", "shellder", "gastly", "onix", "drowzee",
  "krabby", "voltorb", "exeggcute", "cubone", "koffing", "rhyhorn", "horsea", "goldeen", "staryu",
  "magikarp", "eevee", "porygon", "dratini", "snorlax", "chikorita", "cyndaquil", "totodile", "togepi",
  "mareep", "wooper", "teddiursa", "mudkip", "torchic", "treecko", "ralts", "piplup", "turtwig", "chimchar",
] as const;
