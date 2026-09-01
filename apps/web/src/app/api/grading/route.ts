import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { listGradeableCards, listSubmissions, listServiceTiers } from '@/server/grading-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });
  const [submissions, candidates] = await Promise.all([
    listSubmissions(player.id),
    listGradeableCards(player.id),
  ]);
  return NextResponse.json({ submissions, candidates, tiers: listServiceTiers() });
}
