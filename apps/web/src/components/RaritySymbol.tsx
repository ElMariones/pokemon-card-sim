import { cn } from "@/lib/cn";
import { rarityDisplay } from "@/lib/rarity-display";
import type { RarityTier } from "@pcs/shared";

/**
 * Rarity as a shape, never as a colour (DESIGN.md section 32).
 *
 * These reuse the vocabulary already printed in the corner of every Pokémon
 * card — circle, diamond, star — so a collector reads them without being
 * taught, and a colourblind player gets the full signal from the silhouette.
 */
export function RaritySymbol({
  tier,
  className,
  title = true,
}: {
  tier: RarityTier;
  className?: string;
  title?: boolean;
}) {
  const d = rarityDisplay(tier);
  const c = cn("inline-block shrink-0", className);
  const label = title ? d.label : undefined;

  const svg = (children: React.ReactNode) => (
    <svg viewBox="0 0 16 16" className={c} aria-hidden="true" fill="currentColor">
      {children}
    </svg>
  );

  const shape = (() => {
    switch (d.symbol) {
      case "circle":
        return svg(<circle cx="8" cy="8" r="4.5" />);
      case "diamond":
        return svg(<path d="M8 2.5 13.5 8 8 13.5 2.5 8Z" />);
      case "star":
        return svg(<path d="M8 1.8l1.9 4.1 4.4.5-3.3 3 .9 4.4L8 11.6 4.1 13.8l.9-4.4-3.3-3 4.4-.5Z" />);
      case "star-holo":
        return svg(
          <>
            <path d="M8 .8 14.6 4.4v7.2L8 15.2 1.4 11.6V4.4Z" opacity="0.28" />
            <path d="M8 3.4l1.5 3.2 3.5.4-2.6 2.4.7 3.4L8 11.1l-3.1 1.7.7-3.4L3 7l3.5-.4Z" />
          </>,
        );
      case "double-star":
        return svg(
          <>
            <path d="M5.4 2.2l1.3 2.8 3 .3-2.2 2 .6 3-2.7-1.5-2.7 1.5.6-3-2.2-2 3-.3Z" />
            <path d="M11.2 7.4l1 2.2 2.4.2-1.8 1.6.5 2.4-2.1-1.2-2.1 1.2.5-2.4-1.8-1.6 2.4-.2Z" />
          </>,
        );
      case "burst":
        return svg(
          <path d="M8 0l1.5 4.4L13.7 2.3l-2.1 4.2L16 8l-4.4 1.5 2.1 4.2-4.2-2.1L8 16l-1.5-4.4-4.2 2.1 2.1-4.2L0 8l4.4-1.5L2.3 2.3l4.2 2.1Z" />,
        );
      case "seal":
        return svg(
          <>
            <circle cx="8" cy="8" r="6.5" opacity="0.3" />
            <path d="M8 3.6l1.2 2.6 2.8.3-2.1 1.9.6 2.8L8 9.8l-2.5 1.4.6-2.8-2.1-1.9 2.8-.3Z" />
          </>,
        );
      case "bolt":
        return svg(<path d="M9.4 1 3.6 9h3.2l-.8 6 6-8.4H8.7Z" />);
      default:
        return svg(
          <path d="M8 1.5A6.5 6.5 0 1 0 8 14.5 6.5 6.5 0 0 0 8 1.5Zm.9 10.2H7.1v-1.8h1.8Zm.2-3H6.9V8c0-1.6 2-1.6 2-2.6a1 1 0 0 0-2 0H5.2c0-1.6 1.3-2.7 2.8-2.7s2.7 1 2.7 2.6c0 1.5-1.6 1.7-1.6 3Z" />,
        );
    }
  })();

  return (
    <>
      {shape}
      {label ? <span className="sr-only">{d.label}</span> : null}
    </>
  );
}
