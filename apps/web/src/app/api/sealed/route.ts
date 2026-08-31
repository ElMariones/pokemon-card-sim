import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { listSealedOffers, listHoldings } from '@/server/sealed-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });
  const [offers, holdings] = await Promise.all([
    listSealedOffers(),
    listHoldings(player.id),
  ]);
  return NextResponse.json({ offers, holdings });
}
