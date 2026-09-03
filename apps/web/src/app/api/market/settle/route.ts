import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { settleMarket } from '@/server/market-service';

export const dynamic = 'force-dynamic';

/**
 * Resolve elapsed marketplace visitors from the persistent app shell.
 * POST reflects that a successful check can sell cards and write the ledger.
 */
export async function POST() {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  try {
    return NextResponse.json(await settleMarket(player.id));
  } catch (error) {
    console.error('market settlement failed', error);
    return NextResponse.json({ error: 'Could not check the market' }, { status: 500 });
  }
}
