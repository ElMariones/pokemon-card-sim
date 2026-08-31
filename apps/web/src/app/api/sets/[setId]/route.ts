import { NextResponse } from 'next/server';
import { requirePlayer, getOrCreatePlayer } from '@/server/session';
import { getSetCompletion, getBinder } from '@/server/collection';
import { getPackPrice } from '@/server/game';

export const dynamic = 'force-dynamic';

/** Set detail: completion, the binder checklist, and what a pack costs. */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ setId: string }> },
) {
  const { setId } = await ctx.params;
  const player = (await requirePlayer()) ?? (await getOrCreatePlayer());
  const url = new URL(request.url);

  const completion = await getSetCompletion(player.id, setId);
  if (!completion) return NextResponse.json({ error: 'No such set' }, { status: 404 });

  const binder = await getBinder(player.id, setId, {
    ownedOnly: url.searchParams.get('filter') === 'owned',
    missingOnly: url.searchParams.get('filter') === 'missing',
    rarityTier: url.searchParams.get('rarity') ?? undefined,
  });

  let packPrice: number | null = null;
  try {
    packPrice = await getPackPrice(setId);
  } catch {
    // A set with no priced cards cannot be sold as a pack. Not an error.
  }

  return NextResponse.json({ completion, binder, packPrice });
}
