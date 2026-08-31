"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * Cross-fades page content on navigation.
 *
 * `mode="wait"` is deliberately NOT used here: it holds the outgoing page
 * until its exit finishes, which made navigation feel slower than no
 * transition at all. The pages overlap for a fraction of a second instead.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return <>{children}</>;

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
