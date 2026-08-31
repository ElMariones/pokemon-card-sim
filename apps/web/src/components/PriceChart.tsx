"use client";

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import type { Cents } from "@pcs/shared";

export interface PricePoint {
  day: string;
  price: number;
}

/**
 * 90-day price history for one card.
 *
 * A single series, so there is no legend — the heading names it — and no
 * categorical palette to balance. The line wears the one accent; every number
 * around it wears text tokens, so colour never carries meaning on its own.
 *
 * Rendered as inline SVG with a crosshair and tooltip, because a chart in a
 * web page is interactive by default.
 */
export function PriceChart({
  points,
  low,
  high,
  changeBp,
  className,
  height = 132,
  label = "90-day market price",
}: {
  points: PricePoint[];
  low: number;
  high: number;
  changeBp: number;
  className?: string;
  height?: number;
  label?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 560;
  const H = height;
  const PAD = { top: 10, right: 8, bottom: 18, left: 8 };

  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    // Pad the domain so a flat series does not collapse onto the baseline.
    const span = Math.max(high - low, Math.max(1, high * 0.04));
    const min = low - span * 0.12;
    const max = high + span * 0.12;

    const x = (i: number) =>
      PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) =>
      PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);

    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.price).toFixed(2)}`).join(" ");
    const area =
      `${line} L${x(points.length - 1).toFixed(2)},${H - PAD.bottom} L${x(0).toFixed(2)},${H - PAD.bottom} Z`;

    return { x, y, line, area };
  }, [points, low, high, H]);

  if (!geometry) {
    return (
      <p className={cn("text-manila-3 text-xs", className)}>
        No price history for this card.
      </p>
    );
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const scaled = (ratio * W - PAD.left) / (W - PAD.left - PAD.right);
    const i = Math.round(scaled * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  const active = hover === null ? null : points[hover]!;
  const up = changeBp >= 0;

  return (
    <figure className={cn("m-0", className)}>
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <span className="t-eyebrow text-manila-3">{label}</span>
        <span className="flex items-baseline gap-2">
          <span className="t-num text-manila text-sm tabular-nums">
            {active ? money(active.price as Cents) : money(points[points.length - 1]!.price as Cents)}
          </span>
          <span className={cn("t-mono text-[11px] tabular-nums", up ? "text-gain" : "text-loss")}>
            {up ? "+" : "−"}
            {Math.abs(changeBp / 100).toFixed(1)}%
          </span>
        </span>
      </figcaption>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        style={{ height }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={
          `Price over the last ${points.length} days: from ${money(points[0]!.price as Cents)} ` +
          `to ${money(points[points.length - 1]!.price as Cents)}, ` +
          `low ${money(low as Cents)}, high ${money(high as Cents)}.`
        }
      >
        <defs>
          <linearGradient id="pc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brass)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-brass)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive baseline. No gridlines: 90 points do not need them. */}
        <line
          x1={PAD.left} x2={W - PAD.right}
          y1={H - PAD.bottom} y2={H - PAD.bottom}
          stroke="var(--color-seam)" strokeWidth="1"
        />

        <path d={geometry.area} fill="url(#pc-fill)" />
        <path
          d={geometry.line}
          fill="none"
          stroke="var(--color-brass)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {active && hover !== null && (
          <>
            <line
              x1={geometry.x(hover)} x2={geometry.x(hover)}
              y1={PAD.top} y2={H - PAD.bottom}
              stroke="var(--color-seam-bright)" strokeWidth="1"
            />
            {/* A 2px surface ring keeps the marker readable over the fill. */}
            <circle
              cx={geometry.x(hover)} cy={geometry.y(active.price)}
              r="4.5" fill="var(--color-brass)"
              stroke="var(--color-vitrine)" strokeWidth="2"
            />
          </>
        )}

        <text
          x={PAD.left} y={H - 5}
          className="t-mono" fontSize="9" fill="var(--color-manila-3)"
        >
          {points[0]!.day.slice(5)}
        </text>
        <text
          x={W - PAD.right} y={H - 5} textAnchor="end"
          className="t-mono" fontSize="9" fill="var(--color-manila-3)"
        >
          {active ? active.day.slice(5) : "today"}
        </text>
      </svg>

      <div className="text-manila-3 mt-1 flex justify-between text-[11px] tabular-nums">
        <span>low {money(low as Cents)}</span>
        <span>high {money(high as Cents)}</span>
      </div>
    </figure>
  );
}
