import { NextResponse } from 'next/server';
import { requirePlayer } from '@/server/session';
import { MinigameError, settleRun } from '@/server/minigame-service';

export const dynamic = 'force-dynamic';

/**
 * The score arrives here from the browser, and nothing about it is trusted.
 * These checks only establish that the fields are the right *shape* — whether
 * the numbers are plausible is the service's decision, made against the run's
 * own start time and the content rebuilt from its seed.
 */
export async function POST(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  let body: { runId?: unknown; score?: unknown; durationMs?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { runId, score, durationMs } = body;
  if (typeof runId !== 'string') {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 });
  }
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return NextResponse.json({ error: 'score must be a number' }, { status: 400 });
  }
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
    return NextResponse.json({ error: 'durationMs must be a number' }, { status: 400 });
  }

  try {
    return NextResponse.json(await settleRun(player.id, runId, score, durationMs));
  } catch (err) {
    if (err instanceof MinigameError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error('settle failed', err);
    return NextResponse.json({ error: 'Could not settle that run' }, { status: 500 });
  }
}
