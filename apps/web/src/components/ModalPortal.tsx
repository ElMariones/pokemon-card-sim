"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Mounts an overlay directly on `document.body`.
 *
 * `position: fixed` is only viewport-relative while no ancestor establishes a
 * containing block, and a transform, filter or `will-change` anywhere up the
 * tree quietly does exactly that — including a finished CSS entrance animation
 * that left `transform: matrix(1,0,0,1,0,0)` behind. When that happens a modal
 * silently reanchors to the page content box instead of the window: offset to
 * one side, taller than the screen, and unscrollable because its own overflow
 * container is now enormous.
 *
 * Portalling out of the page tree makes that failure mode impossible, so
 * layout or animation work on a page can never break its dialogs again.
 */
export function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}
