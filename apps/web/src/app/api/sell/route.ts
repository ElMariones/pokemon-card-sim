import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { sellCard, GameError } from '@/server/game';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  let inventoryId: unknown;
  try {
    ({ inventoryId } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (typeof inventoryId !== 'string') {
    return NextResponse.json({ error: 'inventoryId is required' }, { status: 400 });
  }

  try {
    return NextResponse.json(await sellCard(player.id, inventoryId));
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error('sell failed', err);
    return NextResponse.json({ error: 'Could not sell card' }, { status: 500 });
  }
}
