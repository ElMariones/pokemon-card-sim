import { cookies } from 'next/headers';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { users } from '@pcs/db/schema';
import { cents, type Cents } from '@pcs/shared';

/**
 * Anonymous sessions.
 *
 * A player is a row in `users` keyed by an opaque token in an httpOnly cookie.
 * The client never sends a user id — it sends the cookie, and the server
 * resolves it. That keeps the "never trust the client" rule (DESIGN.md 22)
 * true even before real auth exists.
 *
 * When Auth.js lands, `users.sessionToken` becomes nullable-in-practice and an
 * account row links to the same user id, so existing progress survives signup
 * with no data migration.
 */

const COOKIE = 'pcs_session';
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Starting state from DESIGN.md 7. */
export const STARTING_CASH: Cents = cents(50_000); // $500.00
export const STARTING_ALBUM_CAPACITY = 100;

export interface Player {
  id: string;
  cash: Cents;
  xp: number;
  level: number;
  albumCapacity: number;
  displayName: string | null;
}

function toPlayer(row: typeof users.$inferSelect): Player {
  return {
    id: row.id,
    cash: cents(row.cash),
    xp: row.xp,
    level: row.level,
    albumCapacity: row.albumCapacity,
    displayName: row.displayName,
  };
}

/** Resolve the current player, creating one on first visit. */
export async function getOrCreatePlayer(): Promise<Player> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const db = await getDb();

  if (token) {
    const [existing] = await db.select().from(users).where(eq(users.sessionToken, token)).limit(1);
    if (existing) return toPlayer(existing);
  }

  const newToken = randomBytes(32).toString('base64url');
  const [created] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      sessionToken: newToken,
      cash: STARTING_CASH,
      albumCapacity: STARTING_ALBUM_CAPACITY,
    })
    .returning();

  if (!created) throw new Error('Failed to create player');

  jar.set(COOKIE, newToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR,
  });

  return toPlayer(created);
}

/**
 * Resolve the current player without creating one.
 * Route handlers that mutate state use this and 401 rather than silently
 * minting a fresh player with $500 on every unauthenticated request.
 */
export async function requirePlayer(): Promise<Player | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.sessionToken, token)).limit(1);
  return row ? toPlayer(row) : null;
}
