"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Keep a query param in sync with state without adding history entries
 * and without scrolling. Back/forward restores the param, so filters
 * survive navigation.
 */
export function useQueryState(key: string, defaultValue: string) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = searchParams.get(key) ?? defaultValue;

  const setValue = useCallback(
    (next: string) => {
      // Read from window.location so sequential setQueryState calls in the same
      // tick (e.g. setSort(v); setPage(1)) see each other's writes. The hook's
      // searchParams snapshot is stale until the next render, so using it would
      // let the second call overwrite the first.
      const raw = typeof window !== "undefined" ? window.location.search : `?${searchParams.toString()}`;
      const params = new URLSearchParams(raw);
      if (next === "" || next === defaultValue) params.delete(key);
      else params.set(key, next);
      const qs = params.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      // Next observes native history updates in the App Router. Calling
      // router.replace as well starts a second navigation for every filter
      // change (and every keystroke in a search box), which was the largest
      // source of UI jank in otherwise client-only pages.
      if (typeof window !== "undefined") window.history.replaceState(null, "", url);
    },
    [key, defaultValue, pathname, searchParams],
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
  const fullKey = `${pathname}?${searchParams.toString()}`;
  const key = `scroll:${fullKey}`;

  useEffect(() => {
    const saved = sessionStorage.getItem(key);
    if (saved != null) {
      const y = parseInt(saved, 10);
      // defer one frame so content has rendered and height is known
      requestAnimationFrame(() => window.scrollTo(0, y));
    } else {
      // fresh URL — only scroll to top on push, not on pop. pop will have saved.
      // If there's no saved entry, this is a fresh visit; start at top.
      // Avoid scrolling to top when this mount is due to a back/forward pop that
      // simply had no prior save (e.g. direct reload). In that case leave as is.
      // Heuristic: if we just popped, sessionStorage would have an entry; absence
      // means push/reload → top.
      if (!saved) window.scrollTo(0, 0);
    }

    let ticking = false;
    const save = () => {
      sessionStorage.setItem(key, String(window.scrollY));
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
  }, [key]);
}
