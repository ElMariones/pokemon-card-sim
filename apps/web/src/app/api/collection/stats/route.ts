import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { getCollectionStats } from '@/server/collection';

export const dynamic = 'force-dynamic';

export async function GET() {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });
  return NextResponse.json(await getCollectionStats(player.id));
}
