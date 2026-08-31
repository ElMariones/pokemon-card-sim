import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { listSubmissions, listServiceTiers } from '@/server/grading-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });
  return NextResponse.json({
    submissions: await listSubmissions(player.id),
    tiers: listServiceTiers(),
  });
}
