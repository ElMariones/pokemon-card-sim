import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { listActive, listSold } from '@/server/market-service';

export const dynamic = 'force-dynamic';

/** Listing data is read-only; the persistent shell owns settlement and alerts. */
export async function GET() {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  const [active, sold] = await Promise.all([
    listActive(player.id),
    listSold(player.id),
  ]);

  return NextResponse.json({ active, sold });
}
