import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { getArcade } from '@/server/minigame-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  try {
    return NextResponse.json(await getArcade(player.id));
  } catch (err) {
    console.error('arcade view failed', err);
    return NextResponse.json({ error: 'Could not load the arcade' }, { status: 500 });
  }
}
