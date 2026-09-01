import { eq } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { sets } from '@pcs/db/schema';

/**
 * Serve a set's logo from our own origin.
 *
 * The upstream CDN does send `access-control-allow-origin: *`, but only when
 * the request carries an Origin header — its cached response for a plain
 * request has no CORS headers, and that is the one a crossorigin image load
 * gets back, so it fails. Reading the logo's pixels to colour the wrapper
 * therefore has to go through here, where the bytes are same-origin and no
 * CORS is involved at all.
 *
 * Logos never change, so this is cached hard.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ setId: string }> },
) {
  const { setId } = await ctx.params;

  const db = await getDb();
  const [set] = await db
    .select({ logoUrl: sets.logoUrl })
    .from(sets)
    .where(eq(sets.id, setId))
    .limit(1);

  if (!set?.logoUrl) return new Response('No logo for that set', { status: 404 });

  // Only ever fetch from the catalogue's own image host; the URL comes from
  // the database, but pinning the host keeps this from becoming an open proxy.
  let upstream: URL;
  try {
    upstream = new URL(set.logoUrl);
  } catch {
    return new Response('Bad logo URL', { status: 502 });
  }
  if (upstream.hostname !== 'images.pokemontcg.io') {
    return new Response('Unexpected logo host', { status: 502 });
  }

  const res = await fetch(upstream, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return new Response('Upstream error', { status: 502 });

  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
