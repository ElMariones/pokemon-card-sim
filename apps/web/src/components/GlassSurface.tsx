import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A restrained React Bits GlassSurface adaptation. The native backdrop-filter
 * fallback is intentionally used: it keeps reveal text sharp across browsers.
 */
export function GlassSurface({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden border border-white/20 bg-slate-950/58 shadow-[0_14px_34px_rgba(0,0,0,0.36),inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-xl backdrop-saturate-150",
        className,
      )}
      style={style}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/55" />
      {children}
    </div>
  );
}
