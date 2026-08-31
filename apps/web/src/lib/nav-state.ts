"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Keep a query param in sync with state without adding history entries
 * and without scrolling. Back/forward restores the param, so filters
 * survive navigation.
 */
export function useQueryState(key: string, defaultValue: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = searchParams.get(key) ?? defaultValue;

  const setValue = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "" || next === defaultValue) params.delete(key);
      else params.set(key, next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [key, defaultValue, pathname, router, searchParams],
  );

  return [value, setValue] as const;
}

/**
 * Preserve scroll per full URL (pathname + search) in sessionStorage.
 * On mount: restore if we have a saved position for this URL.
 * While mounted: throttle-save on scroll.
 * On unmount / before navigating away: flush.
 *
 * This complements `scroll:false` on Links — Next won't scroll to top,
 * and we decide: saved position → restore, otherwise → top for fresh URLs.
 */
export function usePreservedScroll() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const keyRef = useRef<string>("");

  const fullKey = `${pathname}?${searchParams.toString()}`;
  // keep ref in sync for scroll handler closure
  keyRef.current = `scroll:${fullKey}`;

  useEffect(() => {
    const key = keyRef.current;
    const saved = sessionStorage.getItem(key);
    if (saved != null) {
      const y = parseInt(saved, 10);
      // defer one frame so content has rendered and height is known
      requestAnimationFrame(() => window.scrollTo(0, y));
    } else {
      // fresh URL — only scroll to top on push, not on pop. pop will have saved.
      // If there's no saved entry, this is a fresh visit; start at top.
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      // Avoid scrolling to top when this mount is due to a back/forward pop that
      // simply had no prior save (e.g. direct reload). In that case leave as is.
      // Heuristic: if we just popped, sessionStorage would have an entry; absence
      // means push/reload → top.
      if (!saved) window.scrollTo(0, 0);
    }

    let ticking = false;
    const save = () => {
      sessionStorage.setItem(keyRef.current, String(window.scrollY));
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        save();
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // also save on page hide / before unload for bfcache
    const onPageHide = () => save();
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);

    return () => {
      save();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
    };
  }, [fullKey]);
}
