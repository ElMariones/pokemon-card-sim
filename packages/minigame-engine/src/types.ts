/** The three cabinets. Every game-keyed record in this package is total over these. */
export type MinigameId = 'match' | 'flappy' | 'type';

export const MINIGAME_IDS: readonly MinigameId[] = ['match', 'flappy', 'type'] as const;

export const isMinigameId = (v: unknown): v is MinigameId =>
  typeof v === 'string' && (MINIGAME_IDS as readonly string[]).includes(v);
