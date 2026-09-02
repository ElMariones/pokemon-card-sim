"use client";

import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useRef } from "react";
import { cn } from "@/lib/cn";

export function BorderGlow({
  children,
  className,
  glowColor = "211 160 60",
  radius = 10,
  animated = false,
}: {
  children: ReactNode;
  className?: string;
  glowColor?: string;
  radius?: number;
  animated?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const card = ref.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--glow-x", `${event.clientX - rect.left}px`);
    card.style.setProperty("--glow-y", `${event.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onPointerMove={move}
      className={cn("border-glow", animated && "border-glow--animated", className)}
      style={{
        "--border-glow-color": glowColor,
        "--border-glow-radius": `${radius}px`,
      } as CSSProperties}
    >
      <span className="border-glow__edge" aria-hidden="true" />
      <div className="border-glow__inner">{children}</div>
    </div>
  );
}
