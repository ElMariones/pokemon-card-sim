import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { buyAndOpenPack, GameError } from '@/server/game';

export const dynamic = 'force-dynamic';

/** A ten-pack is the biggest single purchase the shop offers. */
const MAX_PACKS = 10;

/**
 * Buy and open one pack, or up to ten.
 *
 * The client sends a set id and how many packs it wants. The server charges,
 * generates the seed, simulates each pack and writes the inventory. The client
 * is told what it got; it never gets to say (DESIGN.md section 22).
 *
 * Packs are opened one at a time rather than in a single transaction: each is
 * its own purchase with its own ledger row, so running out of cash on the
 * seventh keeps the first six.
 */
export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) {
    return NextResponse.json({ error: 'No session' }, { status: 401 });
  }

  let setId: unknown;
  let count: unknown;
  try {
    ({ setId, count } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (typeof setId !== 'string' || !setId) {
    return NextResponse.json({ error: 'setId is required' }, { status: 400 });
  }

  const wanted = count === undefined ? 1 : Number(count);
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > MAX_PACKS) {
    return NextResponse.json({ error: `count must be 1 to ${MAX_PACKS}` }, { status: 400 });
  }

  const openings: Awaited<ReturnType<typeof buyAndOpenPack>>[] = [];
  try {
    for (let i = 0; i < wanted; i++) {
      openings.push(await buyAndOpenPack(player.id, setId));
    }
  } catch (err) {
    if (err instanceof GameError) {
      // Whatever was already opened is the player's; report it alongside the
      // reason the rest did not happen.
      if (openings.length > 0) {
        return NextResponse.json({ ...openings[0]!, openings, stoppedAfter: openings.length, error: err.message, code: err.code });
      }
      const status = err.code === 'insufficient_funds' ? 402 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('pack open failed', err);
    return NextResponse.json({ error: 'Could not open pack' }, { status: 500 });
  }

  // A single pack keeps its original shape; a multi-pack adds the list.
  return NextResponse.json(wanted === 1 ? openings[0] : { ...openings[0]!, openings });
}
