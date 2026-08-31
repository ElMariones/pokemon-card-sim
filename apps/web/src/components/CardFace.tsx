"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { rarityDisplay } from "@/lib/rarity-display";
import type { RarityTier } from "@pcs/shared";

/**
 * A card you can pick up and turn over.
 *
 * The 3D is deliberately fake — a CSS perspective transform driven by pointer
 * position, not WebGL. DESIGN.md section 19 rules out WebGL on day one, and a
 * transform plus the foil layers already reads as cardstock catching light.
 *
 * Foil strength comes from the rarity tier via `--foil`, and the sheen tracks
 * the pointer via `--px`/`--py`. Both are CSS custom properties, so the layers
 * in globals.css do the work and no per-rarity animation code exists.
 */
export function CardFace({
  name,
  imageUrl,
  rarityTier,
  flippable = true,
  className,
  priority,
  maxTilt = 14,
}: {
  name: string;
  imageUrl: string | null;
  rarityTier: RarityTier;
  flippable?: boolean;
  className?: string;
  priority?: boolean;
  maxTilt?: number;
}) {
  const d = rarityDisplay(rarityTier);
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, active: false });
  const [flipped, setFlipped] = useState(false);

  // Reduced motion removes the tilt entirely rather than only its transition.
  // A card that still swings under the pointer is exactly what the setting is
  // asking us not to do; turning the card over is intent, so that stays.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      // The foil still tracks the pointer under reduced motion: it is a
      // gradient shifting, not the object moving.
      el.style.setProperty("--px", String(px));
      el.style.setProperty("--py", String(py));
      if (reduceMotion) { setTilt({ rx: 0, ry: 0, active: true }); return; }
      setTilt({ rx: (0.5 - py) * maxTilt, ry: (px - 0.5) * maxTilt, active: true });
    },
    [maxTilt, reduceMotion],
  );

  const reset = useCallback(() => {
    const el = ref.current;
    el?.style.setProperty("--px", "0.5");
    el?.style.setProperty("--py", "0.5");
    setTilt({ rx: 0, ry: 0, active: false });
  }, []);

  const toggle = () => flippable && setFlipped((f) => !f);

  return (
    <div className={cn("[perspective:1400px]", className)}>
      <div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={reset}
        onClick={toggle}
        onKeyDown={(e) => {
          if (!flippable) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
        }}
        role={flippable ? "button" : undefined}
        tabIndex={flippable ? 0 : undefined}
        aria-pressed={flippable ? flipped : undefined}
        aria-label={
          flippable
            ? `${name}, ${d.label}. ${flipped ? "Showing the back" : "Showing the front"}. Activate to turn the card over.`
            : `${name}, ${d.label}`
        }
        className={cn(
          "relative aspect-[2.5/3.5] w-full [transform-style:preserve-3d]",
          "transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]",
          "motion-reduce:transition-none",
          flippable && "cursor-pointer focus-visible:outline-2 focus-visible:outline-brass rounded-card",
        )}
        style={{
          // Reduced motion still flips — it just does not tilt.
          transform: `rotateY(${flipped ? 180 : 0}deg) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
          ["--foil" as string]: String(d.foil),
        }}
      >
        {/* Front */}
        <div className="absolute inset-0 overflow-hidden rounded-card ring-1 ring-seam [backface-visibility:hidden]">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt=""
              fill
              sizes="(max-width: 640px) 80vw, 420px"
              priority={priority}
              unoptimized
              className="object-cover"
            />
          ) : (
            <div className="bg-vitrine-2 text-manila-3 grid h-full place-items-center text-xs">
              no image
            </div>
          )}

          {d.foil > 0 && (
            <>
              <div className="foil-rainbow pointer-events-none absolute inset-0" aria-hidden />
              <div className="foil-spec pointer-events-none absolute inset-0" aria-hidden />
              {d.foil >= 0.6 && (
                <div className="foil-etch pointer-events-none absolute inset-0" aria-hidden />
              )}
            </>
          )}

          {/* A hard edge highlight that moves with the tilt, so the card reads
              as a physical object rather than a picture that rotates. */}
          <div
            className="pointer-events-none absolute inset-0 rounded-card"
            style={{
              background:
                "linear-gradient(calc(var(--px,0.5) * 360deg), rgba(255,255,255,0.10), transparent 38%)",
              opacity: tilt.active ? 1 : 0,
              transition: "opacity 200ms",
            }}
            aria-hidden
          />
        </div>

        {/* Back. Drawn rather than hotlinked: the printed card back is
            copyrighted artwork, and this is a simulator, not a reproduction. */}
        <div
          className={cn(
            "absolute inset-0 overflow-hidden rounded-card ring-1 ring-seam",
            "[backface-visibility:hidden] [transform:rotateY(180deg)]",
            "bg-[#1b2338]",
          )}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "repeating-linear-gradient(45deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 8px)," +
                "radial-gradient(120% 90% at 50% 14%, rgba(120,146,224,0.22), transparent 62%)," +
                "linear-gradient(160deg, #223055 0%, #16203a 55%, #101733 100%)",
            }}
            aria-hidden
          />
          <div className="absolute inset-3 rounded-[8px] ring-1 ring-[#43507a]" aria-hidden />
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <p className="t-display text-[#8fa0d8] text-lg tracking-[0.28em]">POKECARD</p>
              <p className="t-mono mt-1 text-[9px] tracking-[0.3em] text-[#5f6ea8]">SIMULATOR</p>
            </div>
          </div>
        </div>
      </div>

      {flippable && (
        <p className="text-manila-3 mt-2 text-center text-[11px]">
          {flipped ? "Showing the back" : "Click the card to turn it over"}
        </p>
      )}
    </div>
  );
}
