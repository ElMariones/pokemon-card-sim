import { NextResponse } from 'next/server';
import { isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { cards } from '@pcs/db/schema';
import { isMinigameId, MATCH_PAIRS } from '@pcs/minigame-engine';
import { requirePlayer } from '@/server/session';
import { MinigameError, startRun } from '@/server/minigame-service';

export const dynamic = 'force-dynamic';

export interface MatchCard {
  id: string;
  name: string;
  image: string;
}

/**
 * The faces for a Card Match board.
 *
 * Which cards appear does not need to be verifiable — the match ceiling
 * depends only on moves and elapsed time — so these are drawn fresh rather
 * than derived from the seed. What the seed decides is where they sit, which
 * is the part a player could otherwise re-roll by reloading.
 *
 * A board is only playable with twelve *distinct* faces, so coming up short is
 * refused rather than padded. Padding would deal duplicate pictures across
 * different pairs and make the board unwinnable; going quiet would deal twelve
 * blank cards, which is what an empty catalogue used to look like from the
 * player's side. The message names the fix, because the only way to be here is
 * an install whose catalogue was never imported.
 */
async function matchCards(): Promise<MatchCard[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: cards.id, name: cards.name, image: cards.imageSmall })
    .from(cards)
    .where(isNotNull(cards.imageSmall))
    .orderBy(sql`random()`)
    .limit(MATCH_PAIRS);

  const faces = rows.flatMap((r) =>
    r.image ? [{ id: r.id, name: r.name, image: r.image }] : [],
  );

  if (faces.length < MATCH_PAIRS) {
    throw new MinigameError(
      'The card catalogue has no art to deal from. Run `npm run data:all`.',
      'catalogue_empty',
    );
  }

  return faces;
}

export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  let game: unknown;
  try {
    ({ game } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!isMinigameId(game)) {
    return NextResponse.json({ error: 'Unknown game' }, { status: 400 });
  }

  try {
    const run = await startRun(player.id, game);
    const faces = game === 'match' ? await matchCards() : undefined;
    return NextResponse.json({ ...run, faces });
  } catch (err) {
    if (err instanceof MinigameError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error('start run failed', err);
    return NextResponse.json({ error: 'Could not start that game' }, { status: 500 });
  }
}
