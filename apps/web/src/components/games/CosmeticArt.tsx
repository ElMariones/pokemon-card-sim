"use client";

import { cosmeticImage, type Cosmetic } from "@pcs/minigame-engine";
import { cn } from "@/lib/cn";
import { useSpriteGeometry } from "./useSpriteGeometry";

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

  if (cosmetic.game === "snake") {
    return (
      <SnakeParade
        cosmetic={cosmetic}
        dimmed={dimmed !== ""}
        className="snake-preview--swatch"
      />
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

/**
 * An Oran berry: the snake's point snack, drawn small enough to sit on a
 * 30px meadow cell and sharp enough to read there. Pure SVG so the fruit
 * needs no downloaded asset of its own — the only GIFs in the meadow are
 * Pokémon, which is the point.
 */
export function BerryGlyph({ px = 22 }: { px?: number }) {
  return (
    <svg
      viewBox="0 0 26 26"
      width={px}
      height={px}
      aria-hidden="true"
      style={{ overflow: "visible" }}
    >
      <rect x="12" y="1.6" width="2" height="5.4" rx="1" fill="#8a5a2e" />
      <path
        d="M13.2 6.8C11.4 3.6 7.4 2.8 4.4 4.6c1.3 2.8 4.6 4.3 8.8 3.4z"
        fill="#58a860"
      />
      <path
        d="M12.8 6.8C14.6 3.6 18.6 2.8 21.6 4.6c-1.3 2.8-4.6 4.3-8.8 3.4z"
        fill="#58a860"
      />
      <circle cx="13" cy="15.6" r="9.4" fill="#3f92e0" stroke="#1e4d7c" strokeWidth="1.1" />
      <path
        d="M13 6.6a9.4 9.4 0 0 0 0 18.8z"
        fill="#2b6cb8"
        opacity="0.7"
      />
      <ellipse
        cx="9.7"
        cy="11.7"
        rx="2.7"
        ry="1.6"
        transform="rotate(-24 9.7 11.7)"
        fill="#ffffff"
        opacity="0.85"
      />
    </svg>
  );
}

/** One sprite centred on the point its body occupies, at preview sizes. */
function ParadeSprite({
  src,
  body,
  left,
  top = "50%",
  flip = true,
  bob = 0,
}: {
  src: string;
  body: number;
  left: string;
  top?: string;
  /** Parade previews face the way a parade travels: right, so mirrored. */
  flip?: boolean;
  /** Staggered idle bob, in seconds of animation-delay. */
  bob?: number;
}) {
  const { w, h, cx, cy } = useSpriteGeometry(src, body);
  return (
    <span
      className="snake-parade__bob absolute"
      style={{ left, top, animationDelay: bob ? `-${bob}s` : undefined }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        className={cn("pixel block", flip && "-scale-x-100")}
        style={{
          width: w,
          height: h,
          transform: `translate(${-cx * 100}%, ${-cy * 100}%)`,
        }}
      />
    </span>
  );
}

/**
 * The snake's cabinet and shop preview: a slice of the meadow with the
 * equipped head leading two fixed parade members towards a berry.
 *
 * The head is the cosmetic; the followers and the berry are the game, which
 * is why they are hard-coded here rather than sold. Everything is measured
 * and drawn at body scale, like the real playfield, so the preview is the
 * game rather than an illustration of it.
 */
export function SnakeParade({
  cosmetic,
  dimmed,
  className,
}: {
  cosmetic?: Drawable;
  dimmed?: boolean;
  className?: string;
}) {
  const sprite = cosmetic?.sprite ?? 23;
  const headSrc = `/sprites/pokemon/${sprite}.gif`;
  return (
    <span
      className={cn("snake-parade", dimmed && "cosmetic-locked", className)}
      style={paletteVars(cosmetic?.palette)}
    >
      <span className="snake-parade__moon" aria-hidden="true" />
      <span className="snake-parade__grid" aria-hidden="true" />
      <span className="snake-parade__berry" aria-hidden="true">
        <BerryGlyph px={20} />
      </span>
      <ParadeSprite src="/sprites/pokemon/129.gif" body={22} left="26%" bob={1.2} />
      <ParadeSprite src="/sprites/pokemon/133.gif" body={26} left="44%" bob={0.6} />
      <ParadeSprite src={headSrc} body={34} left="62%" bob={0.2} />
    </span>
  );
}
