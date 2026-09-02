import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { openNegotiation } from '@/server/npc-market-service';
import { GameError } from '@/server/game';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });
  let stockId: unknown;
  try { ({ stockId } = await request.json()); } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (typeof stockId !== 'string') {
    return NextResponse.json({ error: 'stockId is required' }, { status: 400 });
  }
  try {
    return NextResponse.json(await openNegotiation(player.id, stockId));
  } catch (error) {
    if (error instanceof GameError) {
      const status = error.code.includes('stock') ? 409 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error('NPC negotiation open failed', error);
    return NextResponse.json({ error: 'Could not start this negotiation' }, { status: 500 });
  }
}
