"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "framer-motion";
import { useRef } from "react";
import { cn } from "@/lib/cn";

export interface AppNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: number;
}

function DockItem({ item, active, mouseX }: {
  item: AppNavItem;
  active: boolean;
  mouseX: MotionValue<number>;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const distance = useTransform(mouseX, (x) => {
    const rect = ref.current?.getBoundingClientRect();
    return rect ? x - rect.left - rect.width / 2 : 999;
  });
  const targetScale = useTransform(distance, [-120, 0, 120], [1, 1.12, 1]);
  const targetY = useTransform(distance, [-120, 0, 120], [0, -3, 0]);
  const scale = useSpring(targetScale, { mass: 0.12, stiffness: 210, damping: 18 });
  const y = useSpring(targetY, { mass: 0.12, stiffness: 210, damping: 18 });
  const Icon = item.icon;

  return (
    <Link
      ref={ref}
      href={item.href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn("app-dock__item", active && "app-dock__item--active")}
    >
      <motion.span className="app-dock__motion" style={{ scale, y }}>
        <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
        <span>{item.label}</span>
        {item.count != null && item.count > 0 && (
          <span className="app-dock__count">{item.count}</span>
        )}
      </motion.span>
    </Link>
  );
}

export function AppNavDock({ items, isActive }: {
  items: AppNavItem[];
  isActive: (href: string) => boolean;
}) {
  const mouseX = useMotionValue(9999);

  return (
    <nav
      className="app-dock hidden flex-1 sm:flex"
      aria-label="Main"
      onPointerMove={(event) => mouseX.set(event.clientX)}
      onPointerLeave={() => mouseX.set(9999)}
    >
      {items.map((item) => (
        <DockItem key={item.href} item={item} active={isActive(item.href)} mouseX={mouseX} />
      ))}
    </nav>
  );
}
