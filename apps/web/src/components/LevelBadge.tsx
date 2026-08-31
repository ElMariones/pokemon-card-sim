"use client";

import { cn } from "@/lib/cn";

/**
 * Collector level and progress toward the next.
 *
 * Progress arrives in basis points because that is how it is computed; the
 * conversion to a percentage happens here and nowhere else.
 */
export function LevelBadge({
  level,
  title,
  progressBp,
  xpToNext,
  className,
}: {
  level: number;
  title: string;
  progressBp: number;
  xpToNext: number | null;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className="ring-brass-dim text-brass grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold tabular-nums ring-1"
        aria-hidden
      >
        {level}
      </span>
      <div className="min-w-0">
        <p className="text-manila truncate text-[12px] leading-tight font-medium">{title}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <div
            className="bg-vitrine-3 h-1 w-16 overflow-hidden rounded-full"
            role="progressbar"
            aria-valuenow={Math.round(progressBp / 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={
              xpToNext === null
                ? `Level ${level}, ${title}, maximum level reached`
                : `Level ${level}, ${title}, ${xpToNext} XP to next level`
            }
          >
            <div
              className="bg-brass-dim h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.min(100, progressBp / 100)}%` }}
            />
          </div>
          <span className="text-manila-3 t-mono text-[10px] tabular-nums">
            {xpToNext === null ? "MAX" : `${xpToNext} xp`}
          </span>
        </div>
      </div>
    </div>
  );
}
