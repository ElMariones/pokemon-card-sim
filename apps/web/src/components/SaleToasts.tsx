"use client";

import { useEffect } from "react";
import { CircleDollarSign, X } from "lucide-react";
import { money } from "@/lib/format";
import type { Cents } from "@pcs/shared";

export interface SaleAlert {
  id: string;
  name: string;
  netProceeds: Cents;
  buyerName: string | null;
}

function SaleToast({ sale, dismiss }: { sale: SaleAlert; dismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(dismiss, 6_000);
    return () => window.clearTimeout(timer);
  }, [dismiss]);

  return (
    <div className="sale-toast pointer-events-auto flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-pane border border-brass-dim bg-ink/95 p-3 shadow-2xl backdrop-blur-md">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gain/15 text-gain">
        <CircleDollarSign size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-manila">Card sold</p>
        <p className="mt-0.5 truncate text-xs text-manila-2">{sale.name}</p>
        <p className="mt-1 text-[11px] text-manila-3">
          {sale.buyerName ? `${sale.buyerName} paid you ` : "You received "}
          <span className="t-num text-gain">+{money(sale.netProceeds)}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={`Dismiss ${sale.name} sale notification`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-manila-3 transition hover:bg-vitrine-3 hover:text-manila"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function SaleToasts({
  sales,
  dismiss,
}: {
  sales: SaleAlert[];
  dismiss: (id: string) => void;
}) {
  if (sales.length === 0) return null;

  return (
    <aside
      aria-label="Sale notifications"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[250] flex flex-col items-end gap-2"
    >
      {sales.map((sale) => (
        <SaleToast
          key={sale.id}
          sale={sale}
          dismiss={() => dismiss(sale.id)}
        />
      ))}
    </aside>
  );
}
