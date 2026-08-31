import { NextResponse } from 'next/server';
import { getOrCreatePlayer } from '@/server/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const player = await getOrCreatePlayer();
  return NextResponse.json({ player });
}
