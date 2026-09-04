"use client";

import { useMemo } from "react";
import { boundsHeight, boundsWidth } from "@pcs/minigame-engine";
import { useSpriteBounds, type SpriteMeasurement } from "./useSpriteBounds";

/**
 * Scale a measured sprite frame so the *body* fits a square of `bodyMax`
 * pixels.
 *
 * A Gen V battle sprite is a canvas with a Pokémon somewhere in the middle of
 * it, and how much of the frame each species fills varies wildly. Two games
 * now draw sprites that must share a scene at a fixed visual weight — the
 * birds of flappy, and the members of a snake's parade — so both scale the
 * measured body rather than the frame. The same maths powers the little
 * preview of a parade in the shop, which is how the preview can honestly show
 * the thing you are buying.
 */
export interface SpriteGeometry {
  /** Drawn size of the whole frame, at the body's aspect ratio. */
  w: number;
  h: number;
  /** Where the body's centre sits inside the drawn frame, 0..1. */
  cx: number;
  cy: number;
}

export function geometryForBody(measurement: SpriteMeasurement, bodyMax: number): SpriteGeometry {
  const { bounds } = measurement;
  const wide = boundsWidth(bounds) * measurement.width;
  const tall = boundsHeight(bounds) * measurement.height;
  const scale = bodyMax / Math.max(wide, tall, 1);
  return {
    w: measurement.width * scale,
    h: measurement.height * scale,
    cx: (bounds.x0 + bounds.x1) / 2,
    cy: (bounds.y0 + bounds.y1) / 2,
  };
}

export function useSpriteGeometry(src: string, bodyMax: number): SpriteGeometry {
  const measurement = useSpriteBounds(src);
  // useMemo over useSpriteBounds' cached result: switching sprites reads the
  // new geometry straight out of the cache instead of flashing a frame at the
  // previous body's size.
  return useMemo(() => geometryForBody(measurement, bodyMax), [measurement, bodyMax]);
}
