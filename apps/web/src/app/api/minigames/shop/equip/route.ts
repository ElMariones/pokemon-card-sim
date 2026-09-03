import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { MinigameError, equipCosmetic } from '@/server/minigame-service';

export const dynamic = 'force-dynamic';

/**
 * The request carries an id and nothing else. The price comes from the
 * catalogue on the server, so there is no number here to tamper with.
 */
export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  let cosmeticId: unknown;
  try {
    ({ cosmeticId } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (typeof cosmeticId !== 'string') {
    return NextResponse.json({ error: 'cosmeticId is required' }, { status: 400 });
  }

  try {
    return NextResponse.json(await equipCosmetic(player.id, cosmeticId));
  } catch (err) {
    if (err instanceof MinigameError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error('equip cosmetic failed', err);
    return NextResponse.json({ error: 'Could not complete that' }, { status: 500 });
  }
}
