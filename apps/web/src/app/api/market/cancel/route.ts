import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { GameError } from '@/server/game';
import { cancelListing } from '@/server/market-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  try {
    if (typeof body.listingId !== 'string') {
      return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
    }
    return NextResponse.json(await cancelListing(player.id, body.listingId));
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error('market cancel failed', err);
    return NextResponse.json({ error: 'Could not complete that' }, { status: 500 });
  }
}
