import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { GameError } from '@/server/game';
import { openSealed } from '@/server/sealed-service';

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
    if (typeof body.inventoryId !== 'string') {
      return NextResponse.json({ error: 'inventoryId is required' }, { status: 400 });
    }
    return NextResponse.json(await openSealed(player.id, body.inventoryId));
  } catch (err) {
    if (err instanceof GameError) {
      const status = err.code === 'insufficient_funds' ? 402 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('sealed open failed', err);
    return NextResponse.json({ error: 'Could not complete that' }, { status: 500 });
  }
}
