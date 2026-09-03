import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { collectGrade, collectReadyGrades } from '@/server/grading-service';
import { GameError } from '@/server/game';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  let body: { gradeId?: unknown; collectAll?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (body.collectAll !== true && typeof body.gradeId !== 'string') {
    return NextResponse.json({ error: 'gradeId is required' }, { status: 400 });
  }

  try {
    return NextResponse.json(
      body.collectAll === true
        ? await collectReadyGrades(player.id)
        : await collectGrade(player.id, body.gradeId as string),
    );
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error('grade collect failed', err);
    return NextResponse.json({ error: 'Could not collect grade' }, { status: 500 });
  }
}
