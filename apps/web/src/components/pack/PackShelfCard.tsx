"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { money } from "@/lib/format";
import { rarityDisplay } from "@/lib/rarity-display";
import type { ChaseCard } from "@/lib/shelf";
import { PackThumb } from "./PackThumb";
import { type Cents, type Confidence } from "@pcs/shared";

/**
 * How a pack's price was arrived at, in the shop's words.
 *
 * The shared CONFIDENCE_LABEL map is written for pull rates ("Estimated pull
 * rate"), which is the wrong sentence for a price.
 */
const PRICE_BASIS: Record<Confidence, { short: string; full: string }> = {
  official: { short: "official", full: "The official retail price for this pack." },
  manufacturer_published: {
    short: "published",
    full: "The manufacturer's published price for this pack.",
  },
  documented_community_data: {
    short: "sealed market",
    full: "What a sealed pack of this set trades for today.",
  },
  estimated: {
    short: "estimated",
    full: "Estimated from the cards inside — no sealed market covers this set.",
  },
  unknown: { short: "unverified", full: "No price source covers this pack." },
};

/** The counts the shop offers on a chip. Anything else goes in the box. */
const PRESETS = [1, 3, 10, 50] as const;
/** Matches MAX_PACKS in /api/packs/open. */
export const MAX_PACKS = 50;

export type { ChaseCard };

export interface ShelfSet {
  id: string;
  name: string;
  era: string;
  releaseDate: string;
  cardCount: number;
  packPrice: number;
  packSize: number;
  packPriceConfidence?: string | null;
  ownedCards?: number;
  chase?: ChaseCard | null;
  logoUrl: string | null;
  symbolUrl: string | null;
}

/** A shelf listing: the pack, what it can pay out, and how many you want. */
function PackShelfCardImpl({
  set,
  cash,
  busy,
  pending,
  reduceMotion,
  onBuy,
}: {
  set: ShelfSet;
  cash: number | null;
  busy: boolean;
  /** True while this listing's own purchase is in flight. */
  pending: boolean;
  /**
   * Passed down rather than read per card: framer-motion animates transforms
   * in JS, so the stylesheet's prefers-reduced-motion rule cannot reach it,
   * and twenty-four listings do not each need their own media subscription.
   */
  reduceMotion: boolean;
  onBuy: (setId: string, count: number) => void;
}) {
  const [count, setCount] = useState(1);
  const [custom, setCustom] = useState("");

  const basis =
    PRICE_BASIS[set.packPriceConfidence as Confidence] ?? PRICE_BASIS.estimated;
  const owned = set.ownedCards ?? 0;
  const pct = set.cardCount > 0 ? Math.round((owned / set.cardCount) * 100) : 0;
  const total = set.packPrice * count;
  const short = cash === null ? 0 : Math.max(0, total - cash);
  const affordable = short === 0;

  const pick = useCallback((n: number) => {
    setCount(n);
    setCustom("");
  }, []);

  const type = useCallback((raw: string) => {
    // Digits only, and never past the server's ceiling: a box the player can
    // type 900 into is a box that promises a purchase the API will refuse.
    //
    // The box is clamped as well as the count. Clamping only the count let the
    // field read "75" while the button charged for 50 — the field has to show
    // what will actually happen.
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    const capped = Number(digits) > MAX_PACKS ? String(MAX_PACKS) : digits;
    setCustom(capped);
    if (Number(capped) >= 1) setCount(Number(capped));
  }, []);


  return (
    <li className="pane shelf-card ring-seam hover:ring-seam-bright p-4 transition sm:p-5">
      <div className="flex gap-4 sm:gap-5">
        <div className="w-[76px] shrink-0 sm:w-[112px]">
          <PackThumb setId={set.id} setName={set.name} pulling={pending} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="t-display text-[15px] leading-tight text-balance sm:text-base">
                <Link
                  href={`/set/${set.id}`}
                  scroll={false}
                  className="hover:text-brass transition"
                >
                  {set.name}
                </Link>
              </h3>
              <p className="text-manila-3 mt-0.5 truncate text-[11px]">
                {set.releaseDate.slice(0, 4)} · {set.cardCount} cards
                {set.packSize > 0 ? ` · ${set.packSize} per pack` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="t-num text-brass text-lg leading-none tabular-nums">
                {money(set.packPrice as Cents)}
              </p>
              <p className="text-manila-3 mt-1 text-[10px] whitespace-nowrap" title={basis.full}>
                per pack<span className="hidden sm:inline"> · {basis.short}</span>
              </p>
            </div>
          </div>

          {/* The reason to pick this set over the one below it. */}
          {set.chase && <ChaseTag chase={set.chase} />}

          <div>
            <div className="text-manila-3 mb-1 flex items-baseline justify-between text-[11px]">
              <span className="t-eyebrow">Collected</span>
              <span className="t-num text-manila-2 tabular-nums">
                {owned}/{set.cardCount} · {pct}%
              </span>
            </div>
            {/* Brass is the shop's one accent and it belongs to money and to
                the buy action. Completion gets a dimmed version of it so the
                listing has a single loud thing, not four. */}
            <div className="bg-vitrine-3 ring-seam h-1.5 overflow-hidden rounded-full ring-1">
              <div
                className="bg-brass-dim h-full rounded-full transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="border-seam mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="qty-rail" role="group" aria-label={`Packs of ${set.name} to open`}>
          {PRESETS.map((n) => {
            const active = count === n && custom === "";
            return (
              <button
                key={n}
                type="button"
                aria-pressed={active}
                onClick={() => pick(n)}
                className="qty-chip"
              >
                {active && (
                  <motion.span
                    layoutId={`qty-${set.id}`}
                    className="qty-chip__mark"
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 480, damping: 34 }
                    }
                    aria-hidden
                  />
                )}
                <span className="qty-chip__label">{n}</span>
              </button>
            );
          })}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_PACKS}
            value={custom}
            onChange={(e) => type(e.target.value)}
            placeholder="any"
            aria-label={`Any number of ${set.name} packs, up to ${MAX_PACKS}`}
            className="qty-input"
          />
        </div>

        <button
          type="button"
          onClick={() => onBuy(set.id, count)}
          disabled={busy || !affordable}
          className="buy-button text-[13px] font-semibold"
          aria-label={
            affordable
              ? `Open ${count} ${set.name} ${count === 1 ? "pack" : "packs"} for ${money(total as Cents)}`
              : `Not enough cash: ${money(total as Cents)} needed for ${count} ${set.name} packs`
          }
        >
          <ShoppingCart className="buy-button__cart h-4 w-4" aria-hidden strokeWidth={2.2} />
          {pending ? (
            <span>Opening…</span>
          ) : affordable ? (
            <>
              <span>Open {count}</span>
              <span className="t-num tabular-nums opacity-80">{money(total as Cents)}</span>
            </>
          ) : (
            <span className="tabular-nums">Short {money(short as Cents)}</span>
          )}
        </button>
      </div>

    </li>
  );
}

/**
 * The biggest card a pack of this set can produce, with its market price.
 *
 * Deliberately not an average or a "cards priced" count: what a shopper wants
 * from a shelf is the size of the prize, and the honest version of that is the
 * top card the pull tables can actually reach (see /api/sets).
 */
function ChaseTag({ chase }: { chase: ChaseCard }) {
  const rarity = rarityDisplay(chase.rarityTier);
  return (
    <div
      className="chase-tag"
      title={`${chase.name} is the most valuable card a pack of this set can contain. Pulling it is rare.`}
    >
      {chase.imageSmall ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="chase-tag__art" src={chase.imageSmall} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="chase-tag__slot" aria-hidden />
      )}
      {/* Two rows rather than three columns: the label pairs with the rarity
          and the name with the price, so both stay on their own baseline when
          the tag is 200px wide on a phone. */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="t-eyebrow text-[9px] leading-none whitespace-nowrap">Biggest pull</p>
          <p className="text-manila-3 shrink-0 text-[9.5px] leading-none whitespace-nowrap">
            {rarity.label}
          </p>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2.5">
          <p className="text-manila truncate text-[12.5px] leading-none font-medium">
            {chase.name}
          </p>
          <p className="t-num text-brass-hot shrink-0 text-[13px] leading-none tabular-nums">
            {money(chase.price as Cents)}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Memoised: the props are all stable — `onBuy` is a `useCallback` on the page —
 * so typing in the search box no longer re-renders every listing on the shelf.
 */
export const PackShelfCard = memo(PackShelfCardImpl);
