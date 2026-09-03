import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { buyAndOpenPacks, GameError } from '@/server/game';

export const dynamic = 'force-dynamic';

/** The biggest single rip the shop offers. */
const MAX_PACKS = 50;

/**
 * Buy and open packs of one set.
 *
 * The client sends a set id and how many packs it wants. The server charges,
 * generates the seeds, simulates each pack and writes the inventory. The
 * client is told what it got; it never gets to say (DESIGN.md section 22).
 *
 * Every pack is its own purchase with its own ledger row, and how many are
 * affordable is settled under the same lock that spends the money — so asking
 * for fifty with cash for six opens six and charges for six.
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

  let openings: Awaited<ReturnType<typeof buyAndOpenPacks>>;
  try {
    openings = await buyAndOpenPacks(player.id, setId, wanted);
  } catch (err) {
    if (err instanceof GameError) {
      const status = err.code === 'insufficient_funds' ? 402 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('pack open failed', err);
    return NextResponse.json({ error: 'Could not open pack' }, { status: 500 });
  }

  const first = openings[0]!;
  // A single pack keeps its original shape; a multi-pack adds the list, and
  // says so when cash ran out before the count did.
  if (wanted === 1) return NextResponse.json(first);
  return NextResponse.json({
    ...first,
    openings,
    ...(openings.length < wanted
      ? { stoppedAfter: openings.length, error: 'Ran out of cash', code: 'insufficient_funds' }
      : {}),
  });
}
