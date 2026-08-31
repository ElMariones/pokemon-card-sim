import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { submitForGrading } from '@/server/grading-service';
import { GameError } from '@/server/game';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  let body: { inventoryId?: unknown; serviceTierId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (typeof body.inventoryId !== 'string' || typeof body.serviceTierId !== 'string') {
    return NextResponse.json(
      { error: 'inventoryId and serviceTierId are required' },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await submitForGrading(player.id, body.inventoryId, body.serviceTierId),
    );
  } catch (err) {
    if (err instanceof GameError) {
      const status = err.code === 'insufficient_funds' ? 402 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('grading submit failed', err);
    return NextResponse.json({ error: 'Could not submit for grading' }, { status: 500 });
  }
}
