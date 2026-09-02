import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { releaseNegotiation } from '@/server/npc-market-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (typeof body.stockId !== 'string' || typeof body.negotiationId !== 'string') {
    return NextResponse.json({ error: 'Negotiation details are incomplete' }, { status: 400 });
  }
  return NextResponse.json(await releaseNegotiation(player.id, body.stockId, body.negotiationId));
}
