"use client";

import { useEffect, useState } from "react";

/**
 * The colours of a booster wrapper, taken from that set's own logo.
 *
 * images.pokemontcg.io serves `access-control-allow-origin: *`, so the logo can
 * be drawn to a canvas and read back. That means each pack is coloured by the
 * artwork it actually carries rather than by a hand-kept table of 174 sets that
 * would drift the moment a set is added.
 */

export interface LogoPalette {
  /** The most saturated colour with real presence in the logo. */
  primary: string;
  /** A second, distinct colour for the gradient. */
  secondary: string;
  /** A darker tone for the wrapper's shaded edges. */
  shade: string;
  /** Whether the pack should use dark or light text over `primary`. */
  onPrimary: string;
}

const FALLBACK: LogoPalette = {
  primary: "#2b3a63",
  secondary: "#16203a",
  shade: "#0b1120",
  onPrimary: "#f4f1e8",
};

/** Resolved palettes, so a logo is sampled once per session. */
const cache = new Map<string, LogoPalette>();
const inFlight = new Map<string, Promise<LogoPalette>>();

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

const darken = (r: number, g: number, b: number, amount: number) =>
  hex(r * (1 - amount), g * (1 - amount), b * (1 - amount));

async function samplePalette(url: string): Promise<LogoPalette> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = url;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Could not load ${url}`));
  });

  // A small canvas is plenty: we want dominant colour, not detail.
  const W = 64;
  const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W)) || 64;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return FALLBACK;
  ctx.drawImage(img, 0, 0, W, H);

  const { data } = ctx.getImageData(0, 0, W, H);

  // Buckets of hue x lightness band, weighted by saturation. Logos are mostly
  // outline and shadow, so counting raw pixels picks black every time; the
  // weight is what makes a vivid minority colour win.
  const buckets = new Map<string, { r: number; g: number; b: number; w: number; n: number }>();

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 160) continue; // transparent logo margins
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const { h, s, l } = rgbToHsl(r, g, b);
    if (l < 0.12 || l > 0.94) continue; // near-black outline, near-white fill
    if (s < 0.18) continue;             // greys carry no identity

    const key = `${Math.round(h * 12)}:${Math.round(l * 3)}`;
    const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, w: 0, n: 0 };
    const weight = s * s;
    cur.r += r * weight; cur.g += g * weight; cur.b += b * weight;
    cur.w += weight; cur.n += 1;
    buckets.set(key, cur);
  }

  const ranked = [...buckets.values()]
    .filter((x) => x.n > 4)
    .sort((a, b) => b.w - a.w)
    .map((x) => ({ r: x.r / x.w, g: x.g / x.w, b: x.b / x.w, w: x.w }));

  if (ranked.length === 0) return FALLBACK;

  const first = ranked[0]!;
  // The second colour must be visibly different, or the gradient reads flat.
  const second =
    ranked.find((c) => {
      const d = Math.abs(c.r - first.r) + Math.abs(c.g - first.g) + Math.abs(c.b - first.b);
      return d > 120;
    }) ?? { r: first.r * 0.45, g: first.g * 0.45, b: first.b * 0.55, w: 0 };

  const { l } = rgbToHsl(first.r, first.g, first.b);

  return {
    primary: hex(first.r, first.g, first.b),
    secondary: hex(second.r, second.g, second.b),
    shade: darken(first.r, first.g, first.b, 0.62),
    onPrimary: l > 0.55 ? "#141821" : "#f6f3ea",
  };
}

/** Palette for a set logo. Returns the fallback until the sample resolves. */
export function useLogoPalette(logoUrl: string | null | undefined): LogoPalette {
  const [palette, setPalette] = useState<LogoPalette>(() =>
    logoUrl ? (cache.get(logoUrl) ?? FALLBACK) : FALLBACK,
  );

  useEffect(() => {
    if (!logoUrl) { setPalette(FALLBACK); return; }

    const cached = cache.get(logoUrl);
    if (cached) { setPalette(cached); return; }

    let alive = true;
    let promise = inFlight.get(logoUrl);
    if (!promise) {
      promise = samplePalette(logoUrl)
        .then((p) => { cache.set(logoUrl, p); return p; })
        .catch(() => FALLBACK)
        .finally(() => inFlight.delete(logoUrl));
      inFlight.set(logoUrl, promise);
    }
    void promise.then((p) => { if (alive) setPalette(p); });

    return () => { alive = false; };
  }, [logoUrl]);

  return palette;
}
