"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { LevelBadge } from "./LevelBadge";
import { usePlayer } from "./PlayerProvider";

/**
 * The persistent shell header.
 *
 * It lives in the root layout, so it is never unmounted by a navigation and
 * never has to re-fetch. Previously each page rendered its own copy from its
 * own state, which is why it flickered and, inside the pack-opening view,
 * disappeared entirely and stranded the player on the page.
 */

const NAV = [
  { href: "/", label: "Packs" },
  { href: "/collection", label: "Collection", badge: "collection" as const },
  { href: "/market", label: "Market" },
  { href: "/sealed", label: "Sealed" },
  { href: "/grading", label: "Grading" },
  { href: "/missions", label: "Missions" },
];

export function AppHeader() {
  const { player, progression, collectionCount } = usePlayer();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="border-seam/70 bg-ink/85 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3">
        <Link
          href="/"
          className="hover:text-brass flex shrink-0 items-baseline gap-2 transition"
        >
          <span className="t-display text-[15px] tracking-tight">PokeCard</span>
          <span className="text-manila-3 hidden text-[10px] tracking-[0.2em] uppercase lg:inline">
            Collector Simulator
          </span>
        </Link>

        <nav
          className="hidden flex-1 items-center gap-0.5 sm:flex"
          aria-label="Main"
        >
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-pane px-3 py-1.5 text-xs tracking-wide uppercase transition",
                  active
                    ? "text-manila bg-vitrine-3"
                    : "text-manila-3 hover:text-manila hover:bg-vitrine-2/60",
                )}
              >
                {item.label}
                {item.badge === "collection" && collectionCount > 0 && (
                  <span className="text-manila-3 ml-1.5 tabular-nums">{collectionCount}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-5">
          {progression && (
            <LevelBadge
              className="hidden md:flex"
              level={progression.level}
              title={progression.title}
              progressBp={progression.progressBp}
              xpToNext={progression.xpToNext}
            />
          )}
          <div className="text-right">
            <p className="t-eyebrow text-manila-3 leading-none">Cash</p>
            <p className="t-num text-brass mt-0.5 leading-none tabular-nums">
              {player ? money(player.cash) : "—"}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label="Menu"
            className="text-manila-2 ring-seam rounded-pane px-2.5 py-1.5 text-xs ring-1 sm:hidden"
          >
            Menu
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-seam/70 border-t sm:hidden" aria-label="Main">
          <ul className="mx-auto max-w-7xl px-3 py-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "block rounded-pane px-3 py-2.5 text-sm",
                    isActive(item.href) ? "text-manila bg-vitrine-3" : "text-manila-2",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
