import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { getProgression } from '@/server/progression-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });
  return NextResponse.json(await getProgression(player.id));
}
