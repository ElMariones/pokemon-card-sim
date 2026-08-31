import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { collectGrade } from '@/server/grading-service';
import { GameError } from '@/server/game';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  let gradeId: unknown;
  try {
    ({ gradeId } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (typeof gradeId !== 'string') {
    return NextResponse.json({ error: 'gradeId is required' }, { status: 400 });
  }

  try {
    return NextResponse.json(await collectGrade(player.id, gradeId));
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error('grade collect failed', err);
    return NextResponse.json({ error: 'Could not collect grade' }, { status: 500 });
  }
}
