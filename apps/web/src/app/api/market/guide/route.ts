import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { GameError } from '@/server/game';
import { priceGuide } from '@/server/market-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  try {
    if (typeof body.inventoryItemId !== 'string') {
      return NextResponse.json({ error: 'inventoryItemId is required' }, { status: 400 });
    }
    return NextResponse.json(await priceGuide(player.id, body.inventoryItemId));
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error('market guide failed', err);
    return NextResponse.json({ error: 'Could not complete that' }, { status: 500 });
  }
}
