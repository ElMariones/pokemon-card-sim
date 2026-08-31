import { cn } from "@/lib/cn";

/**
 * Completion as a bar plus a number.
 *
 * The value arrives in basis points (10000 = 100%) because that is how it is
 * computed and stored; converting to a percentage is a presentation concern
 * and happens here, once.
 */
export function CompletionBar({
  bp,
  owned,
  total,
  className,
  label = "Set completion",
}: {
  bp: number;
  owned: number;
  total: number;
  className?: string;
  label?: string;
}) {
  const pct = bp / 100;
  const complete = owned >= total && total > 0;

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="t-eyebrow text-manila-3">{label}</span>
        <span className="t-num text-[13px] tabular-nums">
          <span className={complete ? "text-brass" : "text-manila"}>{owned}</span>
          <span className="text-manila-3"> / {total}</span>
          <span className="text-manila-3 ml-2">{pct.toFixed(1)}%</span>
        </span>
      </div>
      <div
        className="bg-vitrine-3 ring-seam/60 h-1.5 w-full overflow-hidden rounded-full ring-1"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${owned} of ${total}`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            complete ? "bg-brass" : "bg-brass-dim",
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
