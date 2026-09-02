"use client";

import { useMemo, useRef, useState } from "react";
import { money } from "@/lib/format";
import type { Cents } from "@pcs/shared";

const CHART_W = 760;
const CHART_H = 270;
const CHART_PAD = { top: 22, right: 12, bottom: 30, left: 12 } as const;

export interface MoneyPoint {
  date: string;
  income: number;
  expense: number;
  net: number;
  balance: number;
}

export function MoneyFlowChart({ points, mode }: {
  points: MoneyPoint[];
  mode: "day" | "week" | "month";
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = CHART_W;
  const H = CHART_H;
  const PAD = CHART_PAD;

  const chart = useMemo(() => {
    if (points.length === 0) return null;
    const balances = points.map((point) => point.balance);
    const minBalance = Math.min(...balances);
    const maxBalance = Math.max(...balances);
    const balanceSpan = Math.max(100, maxBalance - minBalance);
    const maxFlow = Math.max(1, ...points.flatMap((point) => [point.income, point.expense]));
    const plotBottom = H - PAD.bottom;
    const flowHeight = 76;
    const x = (index: number) => points.length === 1
      ? W / 2
      : PAD.left + (index / (points.length - 1)) * (W - PAD.left - PAD.right);
    const y = (balance: number) => PAD.top +
      (1 - (balance - (minBalance - balanceSpan * 0.12)) / (balanceSpan * 1.24)) *
      (H - PAD.top - PAD.bottom - 20);
    const barHeight = (amount: number) => Math.max(amount > 0 ? 2 : 0, (amount / maxFlow) * flowHeight);
    const line = points.map((point, index) =>
      `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.balance).toFixed(2)}`,
    ).join(" ");
    const area = `${line} L${x(points.length - 1)},${plotBottom} L${x(0)},${plotBottom} Z`;
    return { x, y, barHeight, line, area, plotBottom, minBalance, maxBalance };
  }, [points, H, PAD, W]);

  if (!chart) return <p className="text-manila-3 py-16 text-center text-sm">No cash activity yet.</p>;

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
  };
  const activeIndex = hover ?? points.length - 1;
  const active = points[activeIndex]!;
  const barWidth = Math.max(3, Math.min(12, (W - PAD.left - PAD.right) / Math.max(1, points.length) * 0.32));

  return (
    <figure className="m-0">
      <figcaption className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="t-eyebrow text-manila-3">Cash movement</p>
          <p className="text-manila-2 mt-1 text-xs">
            {mode === "day" ? "Daily" : mode === "week" ? "Weekly" : "Monthly"} balance with income and spending
          </p>
        </div>
        <div className="flex items-baseline gap-4 text-right">
          <span>
            <span className="text-manila-3 mr-1.5 text-[10px] uppercase">In</span>
            <span className="t-num text-gain text-xs">+{money(active.income as Cents)}</span>
          </span>
          <span>
            <span className="text-manila-3 mr-1.5 text-[10px] uppercase">Out</span>
            <span className="t-num text-loss text-xs">−{money(active.expense as Cents)}</span>
          </span>
          <span className="t-num text-brass text-base">{money(active.balance as Cents)}</span>
        </div>
      </figcaption>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        style={{ height: 270 }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Cash balance from ${money(chart.minBalance as Cents)} to ${money(chart.maxBalance as Cents)} across ${points.length} ${mode} periods.`}
      >
        <defs>
          <linearGradient id="money-balance-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-brass)" stopOpacity=".23" />
            <stop offset="1" stopColor="var(--color-brass)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD.left} x2={W - PAD.right} y1={chart.plotBottom} y2={chart.plotBottom} stroke="var(--color-seam)" />
        {points.map((point, index) => (
          <g key={point.date} opacity={hover === null || hover === index ? 1 : .42}>
            <rect
              x={chart.x(index) - barWidth - 1}
              y={chart.plotBottom - chart.barHeight(point.income)}
              width={barWidth}
              height={chart.barHeight(point.income)}
              rx="1.5"
              fill="var(--color-gain)"
              opacity=".58"
            />
            <rect
              x={chart.x(index) + 1}
              y={chart.plotBottom - chart.barHeight(point.expense)}
              width={barWidth}
              height={chart.barHeight(point.expense)}
              rx="1.5"
              fill="var(--color-loss)"
              opacity=".54"
            />
          </g>
        ))}
        <path d={chart.area} fill="url(#money-balance-fill)" />
        <path d={chart.line} fill="none" stroke="var(--color-brass)" strokeWidth="2.3" strokeLinejoin="round" strokeLinecap="round" />
        <line
          x1={chart.x(activeIndex)} x2={chart.x(activeIndex)}
          y1={PAD.top} y2={chart.plotBottom}
          stroke="var(--color-seam-bright)" strokeWidth="1"
        />
        <circle
          cx={chart.x(activeIndex)} cy={chart.y(active.balance)} r="4.5"
          fill="var(--color-brass-hot)" stroke="var(--color-vitrine)" strokeWidth="2"
        />
        <text x={PAD.left} y={H - 7} className="t-mono" fontSize="10" fill="var(--color-manila-3)">
          {points[0]!.date}
        </text>
        <text x={W - PAD.right} y={H - 7} textAnchor="end" className="t-mono" fontSize="10" fill="var(--color-manila-3)">
          {active.date}
        </text>
      </svg>
    </figure>
  );
}
