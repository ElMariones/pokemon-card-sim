"use client";

import { memo } from "react";
import { cn } from "@/lib/cn";
import { useLogoPalette } from "@/lib/logo-palette";

/**
 * A booster pack at shelf size.
 *
 * The shop mounts two dozen of these at once, so it is CSS rather than the
 * vector PackWrapper: a wrapper is two SVGs, thirty-five defs, a mask and a
 * clip path, and twenty-four of them made the shelf reflow in 7ms before the
 * player had touched anything. Everything that costs those nodes — the tear
 * geometry, the serrated crimp teeth, the fin seam — is sub-pixel at 92px.
 *
 * The silhouette that survives is the part that reads at thumbnail size: foil
 * rounded by two inset shadows, a ridged seal top and bottom, and the punched
 * hang hole. Colour still comes from the set's own logo, so the shelf and the
 * opening screen dress the same pack the same way.
 */
export const PackThumb = memo(function PackThumb({
  setId,
  setName,
  className,
  pulling = false,
}: {
  setId: string;
  setName: string;
  className?: string;
  /** True while this set's purchase is in flight — the pack is off the peg. */
  pulling?: boolean;
}) {
  // Same-origin copy, so the wrapper's colours can be read from the artwork.
  const logoUrl = `/api/set-logo/${encodeURIComponent(setId)}`;
  const palette = useLogoPalette(logoUrl);

  return (
    <div
      className={cn("pack-thumb", pulling && "pack-thumb--pulling", className)}
      style={
        {
          "--pack-a": palette.primary,
          "--pack-b": palette.secondary,
          "--pack-c": palette.shade,
        } as React.CSSProperties
      }
      role="img"
      aria-label={`${setName} booster pack`}
    >
      <span className="pack-thumb__crimp pack-thumb__crimp--top" aria-hidden />
      {/* The CORS mode has to match the palette sampler's `new Image()`, which
          sets crossOrigin="anonymous". A different mode is a different HTTP
          cache entry, so painting and sampling would fetch every logo twice. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="pack-thumb__logo"
        src={logoUrl}
        alt=""
        crossOrigin="anonymous"
        loading="lazy"
        decoding="async"
      />
      <span className="pack-thumb__crimp pack-thumb__crimp--bottom" aria-hidden />
      <span className="pack-thumb__sheen" aria-hidden />
    </div>
  );
});
