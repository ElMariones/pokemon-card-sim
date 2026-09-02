import { NextResponse } from 'next/server';
import { cents } from '@pcs/shared';
import { requirePlayer } from '@/server/session';
import { makeOffer } from '@/server/npc-market-service';
import { GameError } from '@/server/game';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (typeof body.stockId !== 'string' || typeof body.negotiationId !== 'string'
    || typeof body.totalOffer !== 'number' || !Array.isArray(body.tradeInventoryIds)
    || !body.tradeInventoryIds.every((id) => typeof id === 'string')) {
    return NextResponse.json({ error: 'Offer details are incomplete' }, { status: 400 });
  }
  try {
    return NextResponse.json(await makeOffer(player.id, {
      stockId: body.stockId,
      negotiationId: body.negotiationId,
      totalOffer: cents(body.totalOffer),
      tradeInventoryIds: body.tradeInventoryIds as string[],
    }));
  } catch (error) {
    if (error instanceof GameError) {
      const status = ['hold_expired', 'stock_unavailable'].includes(error.code) ? 409 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error('NPC offer failed', error);
    return NextResponse.json({ error: 'The dealer could not process that offer' }, { status: 500 });
  }
}
