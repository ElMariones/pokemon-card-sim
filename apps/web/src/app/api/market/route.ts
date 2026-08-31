import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { settleMarket, listActive, listSold } from '@/server/market-service';

export const dynamic = 'force-dynamic';

/**
 * Reading the market settles it first: buyers arrive lazily, so the visitors
 * who turned up while nobody was looking are resolved before the listings are
 * reported.
 */
export async function GET() {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  const justSold = await settleMarket(player.id);
  const [active, sold] = await Promise.all([
    listActive(player.id),
    listSold(player.id),
  ]);

  return NextResponse.json({ active, sold, justSold });
}
