"use client";

import { useEffect, useState } from "react";
import { DEFAULT_BOUNDS, opaqueBounds, type SpriteBounds } from "@pcs/minigame-engine";

/**
 * Measure where a sprite actually sits inside its own image.
 *
 * The pixel scan itself lives in the engine package, pure and tested. This is
 * only the browser half: get the image decoded, get its pixels out of a canvas,
 * and cache the answer so a player who dies and restarts does not pay for the
 * measurement again.
 *
 * The natural size comes back with the bounds because these sprites are not
 * square — Pidgey's frame is 42x48, Gyarados's is 102x84 — and anything that
 * draws one into a square box stretches the animal. Whoever positions the
 * sprite needs both numbers to avoid that.
 *
 * Drawing a GIF to a canvas paints its first frame, which is the wrong thing to
 * *render* — it is why the bird is an <img> — but exactly the right thing to
 * measure. A wing-up frame and a wing-down frame differ by a few pixels, and a
 * hitbox that changed shape mid-flap would be worse than one that is a pixel
 * generous at the top.
 */

export interface SpriteMeasurement {
  bounds: SpriteBounds;
  /** The image's own pixel dimensions, so its aspect ratio survives. */
  width: number;
  height: number;
}

/**
 * What to assume before the real thing has been measured. Square, with the
 * forgiving default bounds — a caller scaling to the body gets the right body
 * size out of it either way.
 */
const UNMEASURED: SpriteMeasurement = { bounds: DEFAULT_BOUNDS, width: 48, height: 48 };

const cache = new Map<string, SpriteMeasurement>();

function measure(src: string): Promise<SpriteMeasurement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";

    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (width === 0 || height === 0) return resolve(UNMEASURED);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return resolve({ ...UNMEASURED, width, height });

      ctx.drawImage(img, 0, 0);
      try {
        const { data } = ctx.getImageData(0, 0, width, height);
        resolve({ bounds: opaqueBounds(data, width, height), width, height });
      } catch {
        // A tainted canvas. Same-origin today, but a fallback beats a crash if
        // these ever move to a CDN.
        resolve({ ...UNMEASURED, width, height });
      }
    };

    img.onerror = () => resolve(UNMEASURED);
    img.src = src;
  });
}

export function useSpriteBounds(src: string): SpriteMeasurement {
  // Keyed by src rather than stored bare, so switching sprites reads the new
  // measurement straight out of the cache during render instead of rendering a
  // frame with the previous bird's geometry and correcting it in an effect.
  const [measured, setMeasured] = useState<{ src: string; value: SpriteMeasurement } | null>(null);

  const cached = cache.get(src);
  const value = cached ?? (measured?.src === src ? measured.value : UNMEASURED);

  useEffect(() => {
    if (cache.has(src)) return;

    let live = true;
    void measure(src).then((result) => {
      cache.set(src, result);
      if (live) setMeasured({ src, value: result });
    });
    return () => { live = false; };
  }, [src]);

  return value;
}
