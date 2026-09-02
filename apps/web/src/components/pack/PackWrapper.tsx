"use client";

import { motion } from "framer-motion";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { useLogoPalette } from "@/lib/logo-palette";

/**
 * A booster wrapper.
 *
 * Drawn as one vector so the foil, both crimped seals and the tear line stay
 * registered with each other at any size — a stack of divs and background
 * gradients drifted apart the moment the pack was scaled.
 *
 * The silhouette is the real thing rather than a rounded rectangle: a flat
 * foil sleeve with a serrated crimp along the top and the bottom, a hang hole
 * punched through the top seal, and a tear nick where the crimp meets the
 * body. Those three details are what separate a pack from a playing card at a
 * glance, which matters most at thumbnail size in the shop.
 *
 * Colour comes from the set's own logo (see useLogoPalette) rather than a
 * per-set table, so a newly imported set is dressed correctly without anyone
 * adding an entry for it.
 */

export type PackPhase = "sealed" | "tearing" | "open";

/** Wrapper geometry, in viewBox units. */
const W = 200;
const H = 330;
const CRIMP = 30;
/** Where the wrapper tears: just below the top seal, through the foil. */
const TEAR_Y = CRIMP + 12;

/**
 * The serrated edge of a crimp. Real seals are pressed with fine teeth, and
 * the tear follows them, so the same generator draws both.
 */
function serration(y: number, teeth: number, depth: number, from = 0, to = W): string {
  const step = (to - from) / teeth;
  let d = `M ${from} ${y}`;
  for (let i = 0; i < teeth; i++) {
    const x = from + i * step;
    d += ` L ${x + step / 2} ${y + (i % 2 === 0 ? depth : -depth)} L ${x + step} ${y}`;
  }
  return d;
}

/** A torn foil edge: irregular, unlike the machine-pressed crimp above it. */
function tornEdge(y: number, seed: number): string {
  let d = `M 0 ${y}`;
  let x = 0;
  let n = seed;
  const rand = () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  while (x < W) {
    const dx = 6 + rand() * 12;
    x = Math.min(W, x + dx);
    d += ` L ${x} ${y + (rand() - 0.5) * 9}`;
  }
  return d;
}

interface ArtProps {
  setId?: string | null;
  setName: string;
  logoUrl?: string | null;
  /** "body" omits the top strip and shows the torn edge; "strip" is only it. */
  part: "whole" | "body" | "strip";
  reduceMotion: boolean;
}

function PackArt({ setId, setName, logoUrl, part, reduceMotion }: ArtProps) {
  const uid = useId().replace(/:/g, "");
  // Same-origin copy, so the wrapper's colours can be read from the artwork.
  const sameOriginLogo = setId ? `/api/set-logo/${encodeURIComponent(setId)}` : null;
  const palette = useLogoPalette(sameOriginLogo);
  const logoHref = sameOriginLogo ?? logoUrl ?? null;

  const showStrip = part !== "body";
  const showBody = part !== "strip";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full overflow-visible"
      role="img"
      aria-label={`${setName} booster pack`}
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
          <stop offset="38%" stopColor="#fff" stopOpacity="0.3" />
          <stop offset="48%" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="62%" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>

        <linearGradient id={`iris-${uid}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#6fe6ff" stopOpacity="0.16" />
          <stop offset="34%" stopColor="#a98cff" stopOpacity="0.13" />
          <stop offset="68%" stopColor="#ff7ec2" stopOpacity="0.11" />
          <stop offset="100%" stopColor="#ffd76b" stopOpacity="0.14" />
        </linearGradient>

        {/* Foil is a curved surface: dark at the folded edges, bright down the
            middle. Without this the wrapper reads as flat printed paper. */}
        <linearGradient id={`round-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#000" stopOpacity="0.55" />
          <stop offset="14%" stopColor="#000" stopOpacity="0.12" />
          <stop offset="38%" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="62%" stopColor="#000" stopOpacity="0.06" />
          <stop offset="86%" stopColor="#000" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.6" />
        </linearGradient>

        {/* The pressed ridges of a crimped seal. */}
        <pattern id={`ridge-${uid}`} width="5" height="8" patternUnits="userSpaceOnUse">
          <rect width="5" height="8" fill="none" />
          <line x1="1" y1="0" x2="1" y2="8" stroke="#000" strokeOpacity="0.45" strokeWidth="1.6" />
          <line x1="3.4" y1="0" x2="3.4" y2="8" stroke="#fff" strokeOpacity="0.18" strokeWidth="1.2" />
        </pattern>

        <pattern id={`weave-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
          <rect width="6" height="6" fill="none" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#fff" strokeOpacity="0.07" strokeWidth="1.4" />
        </pattern>

        {/* The sleeve outline: straight sides, seals flush to the edge. */}
        <clipPath id={`sleeve-${uid}`}>
          <path d={`M 3 3 H ${W - 3} V ${H - 3} H 3 Z`} />
        </clipPath>
        <clipPath id={`below-${uid}`}>
          <rect x="0" y={TEAR_Y} width={W} height={H - TEAR_Y} />
        </clipPath>
        <clipPath id={`above-${uid}`}>
          <rect x="-10" y="-20" width={W + 20} height={TEAR_Y + 20} />
        </clipPath>
      </defs>

      {showBody && (
        <g clipPath={part === "body" ? `url(#below-${uid})` : undefined}>
          <g clipPath={`url(#sleeve-${uid})`}>
            <rect x="3" y="3" width={W - 6} height={H - 6} fill={`url(#body-${uid})`} />
            <rect x="3" y="3" width={W - 6} height={H - 6} fill={`url(#iris-${uid})`} />
            <rect x="3" y="3" width={W - 6} height={H - 6} fill={`url(#weave-${uid})`} />
            <rect x="3" y="3" width={W - 6} height={H - 6} fill={`url(#round-${uid})`} />

            {/* The back seam, offset like a real fin seal. */}
            <rect x={W * 0.5 - 1} y="3" width="2" height={H - 6} fill="#000" opacity="0.16" />

            {logoHref && (
              // No crossOrigin here: this element only paints the logo, and
              // asking for a CORS fetch made the CDN's cached non-CORS
              // response fail to load. Pixels are read separately, same-origin.
              <image
                href={logoHref}
                x={W * 0.08}
                y={H * 0.26}
                width={W * 0.84}
                height={H * 0.34}
                preserveAspectRatio="xMidYMid meet"
              />
            )}

            <text
              x={W / 2}
              y={H - CRIMP - 18}
              textAnchor="middle"
              fill={palette.onPrimary}
              opacity="0.9"
              style={{ font: "600 11px var(--font-display), sans-serif", letterSpacing: "0.18em" }}
            >
              {setName.toUpperCase().slice(0, 20)}
            </text>

            <motion.rect
              x="3" y="3" width={W - 6} height={H - 6}
              fill={`url(#sheen-${uid})`}
              initial={false}
              animate={reduceMotion ? { opacity: 0.5 } : { opacity: [0.35, 0.7, 0.35] }}
              transition={reduceMotion ? { duration: 0 } : { duration: 5, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Bottom seal. */}
            <g>
              <rect x="3" y={H - CRIMP} width={W - 6} height={CRIMP - 3} fill={palette.shade} />
              <rect x="3" y={H - CRIMP} width={W - 6} height={CRIMP - 3} fill="#000" opacity="0.35" />
              <rect x="3" y={H - CRIMP} width={W - 6} height={CRIMP - 3} fill={`url(#ridge-${uid})`} opacity="0.75" />
              <path d={serration(H - CRIMP, 34, 3)} fill="none" stroke="#000" strokeOpacity="0.4" strokeWidth="1.6" />
            </g>
          </g>

          {/* The torn foil left behind on the body. */}
          {part === "body" && (
            <>
              <path d={tornEdge(TEAR_Y, 7)} fill="none" stroke="#000" strokeOpacity="0.5" strokeWidth="3.5" strokeLinejoin="round" />
              <path d={tornEdge(TEAR_Y + 1.5, 7)} fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.2" strokeLinejoin="round" />
            </>
          )}
        </g>
      )}

      {showStrip && (
        <g clipPath={part === "strip" ? `url(#above-${uid})` : undefined}>
          <g clipPath={`url(#sleeve-${uid})`}>
            {part === "strip" && (
              <>
                <rect x="3" y="3" width={W - 6} height={TEAR_Y} fill={`url(#body-${uid})`} />
                <rect x="3" y="3" width={W - 6} height={TEAR_Y} fill={`url(#iris-${uid})`} />
                <rect x="3" y="3" width={W - 6} height={TEAR_Y} fill={`url(#weave-${uid})`} />
                <rect x="3" y="3" width={W - 6} height={TEAR_Y} fill={`url(#round-${uid})`} />
              </>
            )}
            {/* Top seal, with its hang hole punched through. */}
            <mask id={`hang-${uid}`}>
              <rect x="0" y="0" width={W} height={CRIMP} fill="#fff" />
              <rect x={W / 2 - 15} y="9" width="30" height="10" rx="5" fill="#000" />
            </mask>
            <g mask={`url(#hang-${uid})`}>
              <rect x="3" y="3" width={W - 6} height={CRIMP - 3} fill={palette.shade} />
              <rect x="3" y="3" width={W - 6} height={CRIMP - 3} fill="#000" opacity="0.35" />
              <rect x="3" y="3" width={W - 6} height={CRIMP - 3} fill={`url(#ridge-${uid})`} opacity="0.75" />
            </g>
            <path d={serration(CRIMP, 34, 3)} fill="none" stroke="#000" strokeOpacity="0.4" strokeWidth="1.6" />
            {/* The nick you start the tear from. */}
            <path d={`M 3 ${CRIMP + 2} l 9 5 l -9 5 Z`} fill="#000" opacity="0.55" />
          </g>
        </g>
      )}

      {/* Rim light, so the wrapper reads as foil rather than paper. */}
      {part !== "strip" && (
        <path
          d={`M 3 3 H ${W - 3} V ${H - 3} H 3 Z`}
          fill="none"
          stroke="#fff"
          strokeOpacity="0.22"
          strokeWidth="1.5"
          clipPath={part === "body" ? `url(#below-${uid})` : undefined}
        />
      )}
    </svg>
  );
}

/**
 * The wrapper as a 3D object.
 *
 * The strip is a separate layer inside a perspective scene, so tearing rotates
 * it away from the pack on a real X axis and it passes over the body on its
 * way out. Doing this inside the SVG only ever produced a 2D slide, which read
 * as the top of the pack disappearing rather than being pulled off.
 */
export function PackWrapper({
  setId,
  setName,
  logoUrl,
  phase,
  reduceMotion,
  className,
}: {
  setId?: string | null;
  setName: string;
  logoUrl?: string | null;
  phase: PackPhase;
  reduceMotion: boolean;
  className?: string;
}) {
  const torn = phase !== "sealed";
  const stripHeight = `${((TEAR_Y + 4) / H) * 100}%`;

  return (
    <div
      className={cn("relative aspect-[200/330] select-none", className)}
      style={{ perspective: "1200px" }}
    >
      <motion.div
        className="absolute inset-0"
        style={{ transformStyle: "preserve-3d" }}
        initial={false}
        // The pack recoils as the strip is pulled, then settles. A wrapper that
        // simply swaps to a torn state does not read as having been opened.
        animate={
          reduceMotion || phase !== "tearing"
            ? { rotateZ: 0, y: 0 }
            : { rotateZ: [0, -1.8, 0.9, 0], y: [0, -10, 5, 0] }
        }
        transition={{ duration: reduceMotion ? 0 : 0.6, ease: [0.3, 0, 0.2, 1] }}
      >
        <PackArt
          setId={setId}
          setName={setName}
          logoUrl={logoUrl}
          part={torn ? "body" : "whole"}
          reduceMotion={reduceMotion}
        />

        <motion.div
          className="absolute inset-x-0 top-0 origin-bottom"
          style={{ height: stripHeight, transformStyle: "preserve-3d" }}
          initial={false}
          animate={
            torn
              ? reduceMotion
                ? { opacity: 0 }
                : { rotateX: -118, y: -58, z: 150, rotateZ: -8, opacity: 0 }
              : { rotateX: 0, y: 0, z: 0, rotateZ: 0, opacity: 1 }
          }
          transition={{ duration: reduceMotion ? 0 : 0.85, ease: [0.32, 0, 0.18, 1] }}
          aria-hidden
        >
          <PackArt
            setId={setId}
            setName={setName}
            logoUrl={logoUrl}
            part="strip"
            reduceMotion={reduceMotion}
          />
        </motion.div>

        {/* Light spilling out of the pack the instant it opens. */}
        {torn && !reduceMotion && (
          <motion.div
            className="pointer-events-none absolute inset-x-2 rounded-full bg-brass-hot blur-md"
            style={{ top: `${(TEAR_Y / H) * 100}%`, height: 10 }}
            initial={{ opacity: 0, scaleX: 0.2 }}
            animate={{ opacity: [0, 0.9, 0], scaleX: [0.2, 1, 1] }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            aria-hidden
          />
        )}
      </motion.div>
    </div>
  );
}
