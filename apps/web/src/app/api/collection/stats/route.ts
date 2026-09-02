import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { getCollectionStats } from '@/server/collection';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  // The shell asks for the cheap half; the collection dashboard asks for all.
  const scope =
    new URL(request.url).searchParams.get('scope') === 'shell' ? 'shell' : 'full';
  return NextResponse.json(await getCollectionStats(player.id, scope));
}
