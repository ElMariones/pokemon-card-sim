import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import {
  CONFIRMED_SUPABASE_PROJECT_REF, getDb, isPgliteMode,
} from '@pcs/db';

export const dynamic = 'force-dynamic';

/** Non-secret proof of which database localhost can currently reach. */
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    const mode = isPgliteMode() ? 'mock' : 'supabase';
    return NextResponse.json({
      ok: true,
      mode,
      projectRef: mode === 'supabase' ? CONFIRMED_SUPABASE_PROJECT_REF : null,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      mode: process.env.DATABASE_MODE ?? 'unconfigured',
      error: error instanceof Error ? error.message : 'Database connection failed',
    }, { status: 503 });
  }
}
