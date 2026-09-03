import { MATCH_PAIRS, type MinigameContent } from './content';
import type { MinigameId } from './types';

/**
 * The plausibility ceilings.
 *
 * These exist to refuse the impossible, not to police the merely excellent.
 * Every constant here is set generously against real play, on the view that a
 * ceiling which occasionally rejects a genuinely great run is a far worse bug
 * than one which occasionally pays a cheat the daily cap they could have
 * ground out honestly anyway.
 *
 * The server passes its own measured elapsed time. The client's `durationMs`
 * is only ever allowed to make a claim *stricter* — it can shorten a run's
 * implied time budget, never lengthen it.
 */

/** Obstacles cannot be cleared faster than they spawn. */
const FLAPPY_MIN_MS_PER_GAP = 700;
/** Two extra, for the obstacles already on screen when a run begins. */
const FLAPPY_GRACE = 2;

/** No one resolves a pair — two flips and a look — faster than this. */
const MATCH_MIN_MS_PER_TURN = 350;
export const MATCH_MAX_SCORE = 1_000;

/** Comfortably above the human record of roughly 220 WPM. */
const TYPE_MAX_WPM = 250;
/** The conventional definition of a "word" for typing speed. */
const CHARS_PER_WORD = 5;

/** A slow page load or a slow network sits between the two clocks. */
const CLOCK_SLACK_MS = 2_000;

export interface ClaimInput {
  game: MinigameId;
  score: number;
  durationMs: number;
  /** now - startedAt, measured by the server against its own clock. */
  serverElapsedMs: number;
  /** Rebuilt from the run's seed. */
  content: MinigameContent;
}

export type ClaimVerdict = { ok: true } | { ok: false; reason: string };

const reject = (reason: string): ClaimVerdict => ({ ok: false, reason });

export function verifyClaim(input: ClaimInput): ClaimVerdict {
  const { game, score, durationMs, serverElapsedMs, content } = input;

  if (!Number.isInteger(score) || score < 0) return reject('score_not_a_natural_number');
  if (!Number.isFinite(durationMs) || durationMs < 0) return reject('duration_invalid');
  if (durationMs > serverElapsedMs + CLOCK_SLACK_MS) return reject('duration_exceeds_server_clock');

  // Trust whichever clock is less favourable to the claim.
  const budget = Math.min(durationMs, serverElapsedMs);

  switch (game) {
    case 'flappy': {
      const ceiling = Math.floor(budget / FLAPPY_MIN_MS_PER_GAP) + FLAPPY_GRACE;
      if (score > ceiling) return reject('flappy_score_exceeds_spawn_rate');
      return { ok: true };
    }

    case 'match': {
      if (score > MATCH_MAX_SCORE) return reject('match_score_above_board_maximum');
      if (score > 0 && budget < MATCH_PAIRS * MATCH_MIN_MS_PER_TURN) {
        return reject('match_solved_faster_than_humanly_possible');
      }
      return { ok: true };
    }

    case 'type': {
      if (content.kind !== 'type') return reject('content_mismatch');
      if (score > content.length) return reject('type_score_exceeds_passage_length');
      const maxChars = (TYPE_MAX_WPM * CHARS_PER_WORD * budget) / 60_000;
      if (score > maxChars) return reject('type_score_exceeds_human_wpm');
      return { ok: true };
    }
  }
}
