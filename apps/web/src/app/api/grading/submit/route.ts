import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { submitForGrading, submitForGradingBulk } from '@/server/grading-service';
import { GameError } from '@/server/game';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  let body: { inventoryId?: unknown; inventoryIds?: unknown; serviceTierId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (typeof body.serviceTierId !== 'string') {
    return NextResponse.json(
      { error: 'serviceTierId is required' },
      { status: 400 },
    );
  }

  try {
    if (Array.isArray(body.inventoryIds)) {
      const ids = body.inventoryIds.filter((x): x is string => typeof x === 'string');
      if (ids.length === 0) return NextResponse.json({ error: 'inventoryIds is required' }, { status: 400 });
      if (ids.length > 20) return NextResponse.json({ error: 'At most 20 cards per submission' }, { status: 400 });
      return NextResponse.json(
        await submitForGradingBulk(player.id, ids, body.serviceTierId),
      );
    }
    if (typeof body.inventoryId === 'string') {
      return NextResponse.json(
        await submitForGrading(player.id, body.inventoryId, body.serviceTierId),
      );
    }
    return NextResponse.json(
      { error: 'inventoryId or inventoryIds is required' },
      { status: 400 },
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
