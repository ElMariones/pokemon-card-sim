import { NextResponse } from 'next/server';
import { cents } from '@pcs/shared';
import { requirePlayer } from '@/server/session';
import { buyNow } from '@/server/npc-market-service';
import { GameError } from '@/server/game';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (typeof body.stockId !== 'string' || !Array.isArray(body.tradeInventoryIds)
    || !body.tradeInventoryIds.every((id) => typeof id === 'string')) {
    return NextResponse.json({ error: 'Purchase details are incomplete' }, { status: 400 });
  }
  // The price the player was looking at when they pressed the button. The sale
  // is refused rather than settled at a different number.
  if (body.expectedTotal !== undefined
    && (typeof body.expectedTotal !== 'number' || !Number.isInteger(body.expectedTotal))) {
    return NextResponse.json({ error: 'Purchase details are incomplete' }, { status: 400 });
  }
  try {
    return NextResponse.json(await buyNow(
      player.id,
      body.stockId,
      body.tradeInventoryIds as string[],
      undefined,
      body.expectedTotal === undefined ? undefined : cents(body.expectedTotal),
    ));
  } catch (error) {
    if (error instanceof GameError) {
      const status = error.code === 'stock_unavailable' ? 409
        : error.code === 'price_moved' ? 409 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error('NPC buy-now failed', error);
    return NextResponse.json({ error: 'The dealer could not complete that purchase' }, { status: 500 });
  }
}
