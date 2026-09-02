import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { getNpcMarket } from '@/server/npc-market-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });
  try {
    return NextResponse.json(await getNpcMarket(player.id));
  } catch (error) {
    console.error('NPC market load failed', error);
    return NextResponse.json({ error: 'Could not open the dealer circuit' }, { status: 500 });
  }
}
