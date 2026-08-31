import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { inventoryItems } from '@pcs/db/schema';
import { requirePlayer } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Toggle a favourite. Ownership is checked server-side, as with every write. */
export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  let body: { inventoryId?: unknown; favorite?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (typeof body.inventoryId !== 'string' || typeof body.favorite !== 'boolean') {
    return NextResponse.json(
      { error: 'inventoryId and favorite are required' },
      { status: 400 },
    );
  }

  const db = await getDb();
  const updated = await db
    .update(inventoryItems)
    .set({ favorite: body.favorite })
    .where(
      and(eq(inventoryItems.id, body.inventoryId), eq(inventoryItems.userId, player.id)),
    )
    .returning();

  if (updated.length === 0) {
    return NextResponse.json({ error: 'You do not own that card' }, { status: 404 });
  }
  return NextResponse.json({ favorite: body.favorite });
}
