import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { buyAndOpenPack, GameError } from '@/server/game';

export const dynamic = 'force-dynamic';

/**
 * Buy and open one pack.
 *
 * The client sends only a set id. The server charges, generates the seed,
 * simulates the pack and writes the inventory. The client is told what it got;
 * it never gets to say (DESIGN.md section 22).
 */
export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) {
    return NextResponse.json({ error: 'No session' }, { status: 401 });
  }

  let setId: unknown;
  try {
    ({ setId } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (typeof setId !== 'string' || !setId) {
    return NextResponse.json({ error: 'setId is required' }, { status: 400 });
  }

  try {
    const result = await buyAndOpenPack(player.id, setId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GameError) {
      const status = err.code === 'insufficient_funds' ? 402 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('pack open failed', err);
    return NextResponse.json({ error: 'Could not open pack' }, { status: 500 });
  }
}
