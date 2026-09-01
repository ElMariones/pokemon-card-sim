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

  const [completion, binder, packPrice] = await Promise.all([
    getSetCompletion(player.id, setId),
    getBinder(player.id, setId, {
      ownedOnly: url.searchParams.get('filter') === 'owned',
      missingOnly: url.searchParams.get('filter') === 'missing',
      rarityTier: url.searchParams.get('rarity') ?? undefined,
    }),
    getPackPrice(setId).catch(() => null),
  ]);
  if (!completion) return NextResponse.json({ error: 'No such set' }, { status: 404 });

  return NextResponse.json({ completion, binder, packPrice });
}
