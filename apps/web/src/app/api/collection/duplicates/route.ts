import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { getDuplicates, sellDuplicates } from '@/server/collection';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  const keep = Math.max(0, Number(new URL(request.url).searchParams.get('keep') ?? 1));
  return NextResponse.json({ keep, groups: await getDuplicates(player.id, keep) });
}

/** Bulk-sell surplus copies. Favourited and graded copies are never included. */
export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  let body: { keep?: unknown; cardIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const keep = Number.isInteger(body.keep) ? Math.max(0, body.keep as number) : 1;
  const cardIds = Array.isArray(body.cardIds)
    ? (body.cardIds as unknown[]).filter((c): c is string => typeof c === 'string')
    : undefined;

  try {
    return NextResponse.json(await sellDuplicates(player.id, keep, cardIds));
  } catch (err) {
    console.error('bulk duplicate sale failed', err);
    return NextResponse.json({ error: 'Could not sell duplicates' }, { status: 500 });
  }
}
