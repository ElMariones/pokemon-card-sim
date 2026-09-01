"use client";

import { motion } from "framer-motion";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { useLogoPalette } from "@/lib/logo-palette";

/**
 * A booster wrapper, drawn as SVG.
 *
 * It is one vector so the foil, the crimp and the tear line are all the same
 * object and stay registered with each other at any size — a stack of divs and
 * background gradients drifted apart the moment the pack was scaled.
 *
 * Colour comes from the set's own logo (see useLogoPalette) rather than a
 * per-set table, so a newly imported set is dressed correctly without anyone
 * adding an entry for it.
 */

export type PackPhase = "sealed" | "tearing" | "open";

/** Where the wrapper tears. Everything above this is the strip that comes off. */
const TEAR_Y = 52;

/** The crimped seal, drawn as a zigzag so the tear has real teeth. */
function crimpPath(y: number, width: number, teeth = 26, depth = 5): string {
  const step = width / teeth;
  let d = `M 0 ${y}`;
  for (let i = 0; i < teeth; i++) {
    const x = i * step;
    d += ` L ${x + step / 2} ${y + (i % 2 === 0 ? depth : -depth)} L ${x + step} ${y}`;
  }
  return d;
}

export function BoosterPackArt({
  setId,
  setName,
  logoUrl,
  phase,
  reduceMotion,
  className,
}: {
  setId?: string | null;
  setName: string;
  logoUrl: string | null;
  phase: PackPhase;
  reduceMotion: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  // Same-origin copy, so the wrapper's colours can be read from the artwork.
  const sameOriginLogo = setId ? `/api/set-logo/${encodeURIComponent(setId)}` : null;
  const palette = useLogoPalette(sameOriginLogo);
  const logoHref = sameOriginLogo ?? logoUrl;

  const W = 250;
  const H = 350;
  const torn = phase !== "sealed";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn("h-full w-full overflow-visible", className)}
      role="img"
      aria-label={`${setName} booster pack${torn ? ", torn open" : ""}`}
    >
      <defs>
        <linearGradient id={`body-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={palette.primary} />
          <stop offset="55%" stopColor={palette.secondary} />
          <stop offset="100%" stopColor={palette.shade} />
        </linearGradient>

        {/* The foil sheen: a bright band raked across the wrapper. */}
        <linearGradient id={`sheen-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0" />
          <stop offset="38%" stopColor="#fff" stopOpacity="0.30" />
          <stop offset="48%" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="62%" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>

        <linearGradient id={`iris-${uid}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#6fe6ff" stopOpacity="0.30" />
          <stop offset="34%" stopColor="#a98cff" stopOpacity="0.24" />
          <stop offset="68%" stopColor="#ff7ec2" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#ffd76b" stopOpacity="0.26" />
        </linearGradient>

        <pattern id={`weave-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
          <rect width="6" height="6" fill="none" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#fff" strokeOpacity="0.07" strokeWidth="1.4" />
        </pattern>

        {/* Everything is clipped to the wrapper silhouette. */}
        <clipPath id={`body-clip-${uid}`}>
          <rect x="6" y="6" width={W - 12} height={H - 12} rx="10" />
        </clipPath>

        {/* Below the tear once opened, so the strip can lift away cleanly. */}
        <clipPath id={`below-${uid}`}>
          <rect x="0" y={TEAR_Y} width={W} height={H - TEAR_Y} />
        </clipPath>
        <clipPath id={`above-${uid}`}>
          <rect x="0" y="0" width={W} height={TEAR_Y} />
        </clipPath>
      </defs>

      {/* ── The body, below the tear ─────────────────────────────────────── */}
      <g clipPath={`url(#${torn ? `below-${uid}` : `body-clip-${uid}`})`}>
        <g clipPath={`url(#body-clip-${uid})`}>
          <rect x="6" y="6" width={W - 12} height={H - 12} rx="10" fill={`url(#body-${uid})`} />
          <rect x="6" y="6" width={W - 12} height={H - 12} rx="10" fill={`url(#iris-${uid})`} />
          <rect x="6" y="6" width={W - 12} height={H - 12} rx="10" fill={`url(#weave-${uid})`} />

          {/* A vertical seam, as on a real wrapper. */}
          <rect x={W / 2 - 1} y="6" width="2" height={H - 12} fill="#000" opacity="0.16" />

          {/* The set logo dominates the wrapper, as it does in print. This is
              the pack's identity; a small mark reads as a placeholder. */}
          {/* No crossOrigin here: this element only paints the logo, and asking
              for a CORS fetch made the CDN's cached non-CORS response fail to
              load. Pixel access is done separately by useLogoPalette. */}
          {logoHref && (
            <image
              href={logoHref}
              x={W * 0.06}
              y={H * 0.24}
              width={W * 0.88}
              height={H * 0.4}
              preserveAspectRatio="xMidYMid meet"
            />
          )}

          <text
            x={W / 2}
            y={H - 34}
            textAnchor="middle"
            fill={palette.onPrimary}
            opacity="0.9"
            style={{ font: "600 12px var(--font-display), sans-serif", letterSpacing: "0.16em" }}
          >
            {setName.toUpperCase().slice(0, 22)}
          </text>

          <motion.rect
            x="6" y="6" width={W - 12} height={H - 12} rx="10"
            fill={`url(#sheen-${uid})`}
            initial={false}
            animate={reduceMotion ? { opacity: 0.5 } : { opacity: [0.35, 0.7, 0.35] }}
            transition={reduceMotion ? { duration: 0 } : { duration: 5, repeat: Infinity, ease: "easeInOut" }}
          />
        </g>

        {/* The torn edge left on the body. */}
        {torn && (
          <path
            d={crimpPath(TEAR_Y, W, 30, 6)}
            fill="none"
            stroke={palette.shade}
            strokeWidth="3"
            strokeLinejoin="round"
          />
        )}
      </g>

      {/* ── The strip that tears off ─────────────────────────────────────── */}
      <motion.g
        clipPath={`url(#above-${uid})`}
        initial={false}
        animate={
          torn && !reduceMotion
            ? { y: -150, x: 62, rotate: -16, opacity: 0 }
            : torn
              ? { opacity: 0 }
              : { y: 0, x: 0, rotate: 0, opacity: 1 }
        }
        transition={{ duration: reduceMotion ? 0 : 0.55, ease: [0.35, 0, 0.2, 1] }}
        style={{ originX: "0.5", originY: "0.2" }}
      >
        <g clipPath={`url(#body-clip-${uid})`}>
          <rect x="6" y="6" width={W - 12} height={TEAR_Y + 8} rx="10" fill={`url(#body-${uid})`} />
          <rect x="6" y="6" width={W - 12} height={TEAR_Y + 8} rx="10" fill={`url(#iris-${uid})`} />
          <rect x="6" y="6" width={W - 12} height={TEAR_Y + 8} fill={`url(#weave-${uid})`} />
        </g>
        {/* The crimped seal itself. */}
        <path
          d={crimpPath(TEAR_Y - 4, W, 30, 6)}
          fill="none"
          stroke="#000"
          strokeOpacity="0.34"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <rect x="6" y="6" width={W - 12} height="12" rx="6" fill="#fff" opacity="0.1" />
      </motion.g>

      {/* Rim light, so the wrapper reads as foil rather than paper. */}
      <rect
        x="6" y="6" width={W - 12} height={H - 12} rx="10"
        fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="1.5"
      />
    </svg>
  );
}
