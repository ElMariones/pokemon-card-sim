/** The cabinets. Every game-keyed record in this package is total over these. */
export type MinigameId = 'match' | 'flappy' | 'type' | 'snake';

export const MINIGAME_IDS: readonly MinigameId[] = ['match', 'flappy', 'type', 'snake'] as const;

export const isMinigameId = (v: unknown): v is MinigameId =>
  typeof v === 'string' && (MINIGAME_IDS as readonly string[]).includes(v);
