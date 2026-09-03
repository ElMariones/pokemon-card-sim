"use client";

import { cosmeticImage, type Cosmetic } from "@pcs/minigame-engine";
import { cn } from "@/lib/cn";

/**
 * How a cosmetic is drawn, wherever it is drawn.
 *
 * The shop, the cabinet on the arcade floor and the game itself all have to
 * render the same three things — a bird, a card back, a backdrop — and the
 * whole promise of the shop is that the preview is the real thing. Keeping the
 * markup in one place is what makes that true: there is no second version of a
 * card back that could drift from the one you flip.
 */

/** Anything with enough of a Cosmetic on it to be drawn. */
export type Drawable = Pick<Cosmetic, "id" | "game" | "name" | "palette"> &
  Partial<Pick<Cosmetic, "sprite" | "artwork" | "image">>;

/** The two colours a cosmetic lights its surroundings with. */
export function paletteVars(palette: readonly [string, string] | undefined) {
  const [near, deep] = palette ?? ["#d3a03c", "#8a6a2a"];
  return { ["--cab" as string]: near, ["--cab-deep" as string]: deep };
}

/**
 * The back of a card.
 *
 * Two kinds. The free default *is* the real Pokémon card back, a photograph of
 * the printed article, so it is shown edge to edge with nothing added. Every
 * other back is a Pokémon's official artwork, which is not a card back until
 * something makes it one — hence the frame, the ball print and the inner rule.
 */
export function CardBack({
  cosmetic,
  className,
}: {
  cosmetic?: Drawable;
  className?: string;
}) {
  const src = cosmetic ? cosmeticImage(cosmetic as Cosmetic) : undefined;
  const printed = Boolean(cosmetic?.image);

  return (
    <span
      className={cn("card-back", printed ? "card-back--printed" : "card-back--framed", className)}
      style={paletteVars(cosmetic?.palette)}
    >
      {src && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={src} alt="" className="card-back__art" loading="eager" draggable={false} />
      )}
    </span>
  );
}

/**
 * The art behind the typing passage.
 *
 * Deliberately pushed to the corner and held under half opacity: this one sits
 * behind body text that the player is reading character by character, and a
 * backdrop that competes with it is a backdrop that costs them accuracy.
 */
export function TypeBackdrop({ cosmetic }: { cosmetic?: Drawable }) {
  const src = cosmetic ? cosmeticImage(cosmetic as Cosmetic) : undefined;
  if (!src) return null;

  return (
    <span className="type-backdrop" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="type-backdrop__art" draggable={false} />
    </span>
  );
}

/**
 * The swatch on a shop card: whatever this item actually is, at rest.
 *
 * An unowned item is drawn faded rather than hidden, because the point of the
 * shop is wanting the thing you cannot afford yet.
 */
export function CosmeticPreview({ cosmetic, owned }: { cosmetic: Drawable; owned: boolean }) {
  const dimmed = owned ? "" : "cosmetic-locked";

  if (cosmetic.game === "flappy") {
    const src = cosmeticImage(cosmetic as Cosmetic);
    return (
      // The mirror lives on the wrapper, not on the image: the idle bob is a
      // transform too, and the two would overwrite each other on one element.
      <span className={cn("inline-block -scale-x-100", dimmed)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          width={96}
          height={96}
          className={cn("pixel h-16 w-16 object-contain", owned && "sprite-bob")}
        />
      </span>
    );
  }

  if (cosmetic.game === "match") {
    // The wrapper owns the box; the back fills whatever it is given.
    return (
      <span className={cn("block h-24 shrink-0", dimmed)} style={{ aspectRatio: "5 / 7" }}>
        <CardBack cosmetic={cosmetic} />
      </span>
    );
  }

  return (
    <span className={cn("type-swatch", dimmed)} style={paletteVars(cosmetic.palette)}>
      <TypeBackdrop cosmetic={cosmetic} />
      <span className="type-swatch__line" aria-hidden="true">
        <span className="type-swatch__typed">evolving sk</span>ies booster box
      </span>
    </span>
  );
}
