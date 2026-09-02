import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function GradientText({
  children,
  className,
  colors = ["#f7cd72", "#e6dcc9", "#74b28a", "#f7cd72"],
  speed = 7,
}: {
  children: ReactNode;
  className?: string;
  colors?: string[];
  speed?: number;
}) {
  return (
    <span
      className={cn("gradient-text", className)}
      style={{
        "--gradient-text-colors": colors.join(", "),
        "--gradient-text-speed": `${speed}s`,
      } as CSSProperties}
    >
      {children}
    </span>
  );
}
