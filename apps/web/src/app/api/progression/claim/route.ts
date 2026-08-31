import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { claimMission, MissionError } from '@/server/progression-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  let missionId: unknown;
  try {
    ({ missionId } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (typeof missionId !== 'string') {
    return NextResponse.json({ error: 'missionId is required' }, { status: 400 });
  }

  try {
    return NextResponse.json(await claimMission(player.id, missionId));
  } catch (err) {
    if (err instanceof MissionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error('claim failed', err);
    return NextResponse.json({ error: 'Could not claim reward' }, { status: 500 });
  }
}
