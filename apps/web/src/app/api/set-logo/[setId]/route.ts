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
 * Two hosts, in order. The catalogue's own CDN is authoritative but stops at
 * the sets it has published: the 2026 sets are in the catalogue with a logo
 * URL that 404s. Scrydex carries them, and names logos predictably from the
 * same set id, so it is the fallback for anything the first host cannot serve.
 *
 * Logos never change, so this is cached hard.
 */

const ALLOWED_HOSTS = new Set(['images.pokemontcg.io', 'images.scrydex.com']);

const scrydexLogo = (setId: string) =>
  `https://images.scrydex.com/pokemon/${encodeURIComponent(setId)}-logo/logo`;

async function fetchLogo(url: string): Promise<Response | null> {
  let upstream: URL;
  try {
    upstream = new URL(url);
  } catch {
    return null;
  }
  // The URL comes from the database, so the host is pinned rather than
  // trusted; without this the route is an open proxy.
  if (!ALLOWED_HOSTS.has(upstream.hostname)) return null;

  try {
    const res = await fetch(upstream, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}
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

  const res =
    (set?.logoUrl ? await fetchLogo(set.logoUrl) : null) ?? (await fetchLogo(scrydexLogo(setId)));

  if (!res) return new Response('No logo for that set', { status: 404 });

  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
