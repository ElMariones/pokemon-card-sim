"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Archive, BadgeCheck, BookOpen, Gamepad2, PackageOpen, ScrollText, Store,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { LevelBadge } from "./LevelBadge";
import { usePlayer } from "./PlayerProvider";
import { PokeballHome } from "./PokeballHome";
import { AppNavDock, type AppNavItem } from "./AppNavDock";

/**
 * The persistent shell header.
 *
 * It lives in the root layout, so it is never unmounted by a navigation and
 * never has to re-fetch. Previously each page rendered its own copy from its
 * own state, which is why it flickered and, inside the pack-opening view,
 * disappeared entirely and stranded the player on the page.
 */

const NAV: AppNavItem[] = [
  { href: "/", label: "Packs", icon: PackageOpen },
  { href: "/collection", label: "Collection", icon: BookOpen },
  { href: "/market", label: "Market", icon: Store },
  { href: "/sealed", label: "Sealed", icon: Archive },
  { href: "/grading", label: "Grading", icon: BadgeCheck },
  { href: "/missions", label: "Missions", icon: ScrollText },
  { href: "/games", label: "Arcade", icon: Gamepad2 },
];

export function AppHeader() {
  const { player, progression, collectionCount } = usePlayer();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const canGoBack = pathname !== "/";
  const ref = useRef<HTMLElement>(null);

  /**
   * Publish the header's height so anything else that sticks can clear it.
   *
   * The height is not a constant: the mobile nav row is part of the header
   * below `sm`, and the level badge appears once the player has one. A page
   * that hard-codes 67px gets its own sticky toolbar hidden underneath.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--app-header-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header
      ref={ref}
      className="border-seam/70 bg-ink/85 sticky top-0 z-40 border-b backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-5 py-2.5">
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 1) router.back();
            else router.push("/");
          }}
          aria-label="Go back"
          className={cn(
            "grid h-7 w-7 place-items-center rounded-pane text-sm transition",
            canGoBack
              ? "text-manila hover:bg-vitrine-3 ring-seam ring-1"
              : "text-manila-3 ring-seam cursor-not-allowed ring-1 opacity-40",
          )}
          disabled={!canGoBack}
        >
          ←
        </button>
        <PokeballHome active={pathname === "/"} />

        <AppNavDock
          items={NAV.map((item) => ({
            ...item,
            count: item.href === "/collection" ? collectionCount : undefined,
          }))}
          isActive={isActive}
        />

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
          <Link
            href="/finances"
            scroll={false}
            aria-label={`Open money dashboard${player ? `, current cash ${money(player.cash)}` : ""}`}
            aria-current={pathname.startsWith("/finances") ? "page" : undefined}
            className={cn(
              "cash-tracker text-right",
              pathname.startsWith("/finances") && "cash-tracker--active",
            )}
          >
            <p className="t-eyebrow text-manila-3 leading-none">Cash</p>
            <p className="t-num text-brass mt-0.5 leading-none tabular-nums">
              {player ? money(player.cash) : "—"}
            </p>
            <span className="cash-tracker__pulse" aria-hidden="true" />
          </Link>

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
            {[...NAV, { href: "/finances", label: "Money", icon: ScrollText }].map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  scroll={false}
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
