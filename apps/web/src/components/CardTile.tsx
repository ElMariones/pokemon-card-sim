"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { rarityDisplay } from "@/lib/rarity-display";
import { RaritySymbol } from "./RaritySymbol";
import { NewCardSticker } from "./NewCardSticker";
import type { Cents, RarityTier } from "@pcs/shared";

/**
 * A single card.
 *
 * Pokémon cards are 63×88mm, so the aspect ratio is fixed at 2.5/3.5 and the
 * image reserves its box before loading — a grid of these must never reflow as
 * art arrives.
 *
 * Foil intensity comes from the rarity tier, not from a per-card flag, so a new
 * rarity gets its treatment by appearing in RARITY_DISPLAY (DESIGN.md §31).
 */
export function CardTile({
  name,
  number,
  rarityTier,
  imageUrl,
  value,
  condition,
  isReverse,
  isNew,
  priority,
  className,
  onClick,
  footer,
}: {
  name: string;
  number?: string;
  rarityTier: RarityTier;
  imageUrl: string | null;
  value?: Cents;
  condition?: string | null;
  isReverse?: boolean;
  isNew?: boolean;
  priority?: boolean;
  className?: string;
  onClick?: () => void;
  footer?: React.ReactNode;
}) {
  const d = rarityDisplay(rarityTier);
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0, active: false });

  // Pointer-tracked tilt is a pure enhancement: it is driven by inline style
  // only while the pointer is down/over, and prefers-reduced-motion neutralises
  // the transition in globals.css.
  const onMove = (e: React.PointerEvent) => {
    if (d.foil <= 0) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ x: px, y: py, active: true });
  };

  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      className={cn(
        "group relative block w-full text-left",
        onClick && "cursor-pointer focus-visible:outline-2 focus-visible:outline-brass rounded-card",
        className,
      )}
      onClick={onClick}
      {...(onClick ? { type: "button" as const, "aria-label": `${name}, ${d.label}` } : {})}
    >
      <div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={() => setTilt({ x: 0, y: 0, active: false })}
        className={cn(
          "relative aspect-[2.5/3.5] w-full overflow-hidden rounded-card",
          "bg-vitrine-2 ring-1 ring-seam/70 transition-transform duration-200",
          "motion-safe:group-hover:-translate-y-0.5",
        )}
        style={
          tilt.active
            ? {
                transform: `perspective(900px) rotateY(${tilt.x * 9}deg) rotateX(${-tilt.y * 9}deg)`,
              }
            : undefined
        }
      >
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 22vw, 180px"
            className="object-cover"
            priority={priority}
            unoptimized
          />
        ) : (
          <div className="text-manila-3 flex h-full items-center justify-center text-xs">
            no image
          </div>
        )}

        {/* Foil. Strength is the rarity's, never the card's. */}
        {d.foil > 0 && (
          <>
            <div
              className="foil-rainbow pointer-events-none absolute inset-0"
              style={{ opacity: d.foil * (tilt.active ? 0.9 : 0.55) }}
              aria-hidden
            />
            {d.foil >= 0.6 && (
              <div
                className="foil-spec pointer-events-none absolute inset-0"
                style={{
                  opacity: d.foil * 0.8,
                  backgroundPosition: `${50 + tilt.x * 60}% ${50 + tilt.y * 60}%`,
                }}
                aria-hidden
              />
            )}
          </>
        )}

        {isReverse && (
          <span className="bg-ink/80 text-manila-2 ring-seam absolute top-1.5 left-1.5 rounded-slab px-1.5 py-0.5 text-[10px] tracking-wide uppercase ring-1">
            Reverse
          </span>
        )}
        {isNew && <NewCardSticker />}
      </div>

      <div className="mt-2 flex items-start gap-1.5">
        <RaritySymbol tier={rarityTier} className="mt-0.5 h-3 w-3 text-manila-2" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-tight font-medium">{name}</p>
          <p className="text-manila-3 t-mono text-[11px]">
            {number ? `#${number}` : null}
            {condition ? ` · ${condition.replace(/_/g, " ")}` : null}
          </p>
        </div>
        {value !== undefined && (
          <span className="t-num text-manila text-[13px] tabular-nums">{money(value)}</span>
        )}
      </div>
      {footer}
    </Wrapper>
  );
}
