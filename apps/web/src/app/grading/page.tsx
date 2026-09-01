"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { usePlayer } from "@/components/PlayerProvider";
import { usePreservedScroll, useQueryState } from "@/lib/nav-state";
import type { Cents } from "@pcs/shared";

interface Submission {
  id: string; cardName: string; imageSmall: string | null;
  company: string; tierName: string; fee: number;
  status: "queued" | "ready" | "completed";
  secondsRemaining: number; numericGrade: number | null; label: string | null;
  estimatedValue: number | null; rawValue: number;
}
interface Tier {
  id: string; company: string; name: string; fee: number;
  turnaroundHours: number; maxDeclaredValue: number; realSecondsToComplete: number;
}
interface OwnedCard {
  inventoryId: string; name: string; number: string; imageSmall: string | null;
  marketBasePrice: number | null; rarityTier: string; setName: string;
}

function bulkFee(singleFee: number, n: number): number {
  if (n <= 1) return singleFee;
  return Math.round(singleFee * Math.pow(n, 0.85));
}

export default function GradingPage() {
  const { player, refresh, setCash: setHeaderCash } = usePlayer();
  usePreservedScroll();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [owned, setOwned] = useState<OwnedCard[]>([]);
  const [picked, setPicked] = useState<OwnedCard[]>([]);
  const [q, setQ] = useQueryState("q", "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const effectiveCash = player?.cash ?? null;

  const load = useCallback(async () => {
    const [g, c] = await Promise.all([
      fetch("/api/grading").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/collection?pageSize=100").then((r) => (r.ok ? r.json() : null)),
    ]);
    if (g) { setSubmissions(g.submissions ?? []); setTiers(g.tiers ?? []); }
    if (c) setOwned(c.items ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Tick the countdowns locally, and refetch when one finishes so the grade
  // is revealed by the server rather than guessed at by the client.
  useEffect(() => {
    if (!submissions.some((s) => s.status === "queued")) return;
    const t = setInterval(() => {
      setSubmissions((prev) => {
        let finished = false;
        const next = prev.map((s) => {
          if (s.status !== "queued") return s;
          const remaining = Math.max(0, s.secondsRemaining - 1);
          if (remaining === 0) finished = true;
          return { ...s, secondsRemaining: remaining };
        });
        if (finished) void load();
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [submissions, load]);

  const toggle = useCallback((c: OwnedCard) => {
    setPicked((prev) => {
      const exists = prev.some((p) => p.inventoryId === c.inventoryId);
      if (exists) return prev.filter((p) => p.inventoryId !== c.inventoryId);
      if (prev.length >= 20) return prev;
      return [...prev, c];
    });
  }, []);

  const clearPicked = useCallback(() => setPicked([]), []);

  const filteredOwned = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = [...owned].sort((a, b) => (b.marketBasePrice ?? 0) - (a.marketBasePrice ?? 0));
    if (term) list = list.filter((c) => c.name.toLowerCase().includes(term) || c.number.toLowerCase().includes(term));
    return list.slice(0, 60);
  }, [owned, q]);

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.inventoryId)), [picked]);
  const maxPickedValue = useMemo(() => Math.max(0, ...picked.map((p) => p.marketBasePrice ?? 0)), [picked]);
  const n = picked.length;

  const submit = async (tierId: string) => {
    if (n === 0) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/grading/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryIds: picked.map((p) => p.inventoryId), serviceTierId: tierId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not submit"); return; }
      if (data.balanceAfter != null) setHeaderCash(data.balanceAfter);
      setPicked([]);
      await load();
      void refresh();
    } finally { setBusy(false); }
  };

  const collect = async (gradeId: string) => {
    const res = await fetch("/api/grading/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gradeId }),
    });
    if (res.ok) { await load(); void refresh(); }
  };

  return (
    <>

      <div className="mx-auto max-w-7xl px-5 py-8">
        {error && (
          <p role="alert" className="text-loss ring-loss/40 mb-6 rounded-pane px-4 py-3 text-sm ring-1">
            {error}
          </p>
        )}

        <section className="mb-10">
          <h1 className="t-display mb-1 text-2xl tracking-tight">Grading</h1>
          <p className="text-manila-2 mb-6 max-w-2xl text-sm">
            A high grade multiplies what a card is worth. A low one certifies that it is
            played. The fee is spent either way, and the card is gone while it is away —
            that is the whole decision. Send up to 20 at once: the per-card cost falls
            (≈ 20 for ~13× the single fee) so bulk is cheaper than singles.
          </p>

          <div className="pane p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="t-eyebrow text-manila-3">
                {n === 0 ? "Choose up to 20 cards to submit" : `${n} / 20 selected`}
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter…"
                  aria-label="Filter cards"
                  className="bg-vitrine-3 ring-seam placeholder:text-manila-3 focus:ring-brass w-36 rounded-pane px-2.5 py-1.5 text-xs ring-1 outline-none"
                />
                {n > 0 && (
                  <button type="button" onClick={clearPicked} className="text-manila-3 hover:text-manila text-xs underline">Clear</button>
                )}
              </div>
            </div>

            {owned.length === 0 ? (
              <p className="text-manila-3 text-sm">
                Nothing to grade yet. <Link href="/" scroll={false} className="text-brass underline">Open a pack.</Link>
              </p>
            ) : (
              <>
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-10">
                  {filteredOwned.map((c) => {
                    const selected = pickedIds.has(c.inventoryId);
                    return (
                      <li key={c.inventoryId}>
                        <button
                          type="button"
                          onClick={() => toggle(c)}
                          aria-pressed={selected}
                          className={cn(
                            "group w-full text-left focus-visible:outline-2 focus-visible:outline-brass rounded-[8px] ring-1 transition",
                            selected ? "ring-brass bg-vitrine-3" : "ring-seam hover:ring-brass",
                          )}
                        >
                          <div className="relative aspect-[2.5/3.5] overflow-hidden rounded-[8px]">
                            {c.imageSmall && (
                              <Image src={c.imageSmall} alt="" fill sizes="110px" unoptimized className="object-cover" />
                            )}
                            {selected && (
                              <span className="bg-brass text-ink absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold">✓</span>
                            )}
                            {picked.length >= 20 && !selected && (
                              <span className="bg-ink/60 absolute inset-0 grid place-items-center text-[10px] tracking-wide uppercase text-white">Full</span>
                            )}
                          </div>
                          <p className="text-manila-2 mt-1 truncate px-1 text-[11px]">{c.name}</p>
                          <p className="t-num text-manila-3 truncate px-1 pb-1 text-[11px] tabular-nums">
                            {money((c.marketBasePrice ?? 0) as Cents)}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {n > 0 && (
                  <div className="border-seam mt-6 border-t pt-5">
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                      <p className="t-eyebrow text-manila-3">Selected</p>
                      <span className="t-num bg-vitrine-3 rounded-full px-2 py-0.5 text-xs tabular-nums">{n} cards</span>
                      <span className="text-manila-3 text-xs">· raw total {money(picked.reduce((a, c) => a + (c.marketBasePrice ?? 0), 0) as Cents)}</span>
                    </div>
                    <div className="mb-4 flex flex-wrap gap-1.5">
                      {picked.map((c) => (
                        <span key={c.inventoryId} className="bg-vitrine-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]">
                          <span className="truncate max-w-[7rem]">{c.name}</span>
                          <button type="button" onClick={() => toggle(c)} className="text-manila-3 hover:text-manila -mr-1 grid h-4 w-4 place-items-center rounded-full text-[10px]">✕</button>
                        </span>
                      ))}
                    </div>

                    <p className="t-eyebrow text-manila-3 mb-2">Choose a service — bulk fee shown</p>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {tiers.map((t) => {
                        const single = t.fee;
                        const total = bulkFee(single, n);
                        const linear = single * n;
                        const saved = linear - total;
                        const tooValuable = maxPickedValue > t.maxDeclaredValue;
                        const affordable = effectiveCash !== null && effectiveCash >= total && !tooValuable;
                        const perCard = Math.round(total / n);
                        return (
                          <li key={t.id}>
                            <button
                              type="button"
                              disabled={!affordable || busy}
                              onClick={() => submit(t.id)}
                              className={cn(
                                "ring-seam w-full rounded-pane p-3 text-left ring-1 transition",
                                affordable ? "hover:ring-brass hover:bg-vitrine-2" : "cursor-not-allowed opacity-50",
                              )}
                            >
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-sm font-medium">{t.name}</span>
                                <span className="t-num text-brass tabular-nums">{money(total as Cents)}</span>
                              </div>
                              <p className="text-manila-3 mt-0.5 text-[11px]">
                                {money(perCard as Cents)} / card · ~{Math.round(t.realSecondsToComplete / 60)} min · up to {money(t.maxDeclaredValue as Cents)} declared
                              </p>
                              {n > 1 && saved > 0 && (
                                <p className="text-gain mt-1 text-[11px]">Save {money(saved as Cents)} vs {money(linear as Cents)} singles</p>
                              )}
                              {tooValuable && (
                                <p className="text-loss mt-1 text-[11px]">A selected card exceeds declared cap</p>
                              )}
                              {!tooValuable && effectiveCash !== null && effectiveCash < total && (
                                <p className="text-loss mt-1 text-[11px]">Not enough cash</p>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-manila-3 mt-3 text-[11px]">Fee = single × n<sup className="text-[9px]">0.85</sup> — e.g. 20× PSA Value is {money(bulkFee(2500, 20) as Cents)} vs {money((2500 * 20) as Cents)} linearly.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section>
          <h2 className="t-display mb-4 text-lg tracking-tight">
            Submissions{" "}
            <span className="text-manila-3 t-num text-sm tabular-nums">{submissions.length}</span>
          </h2>

          {submissions.length === 0 ? (
            <p className="text-manila-3 pane p-6 text-sm">No submissions yet.</p>
          ) : (
            <ul className="space-y-2">
              {submissions.map((s) => (
                <li key={s.id} className="pane flex items-center gap-4 p-3">
                  <div className="ring-seam relative h-16 w-12 shrink-0 overflow-hidden rounded-[6px] ring-1">
                    {s.imageSmall && (
                      <Image src={s.imageSmall} alt="" fill sizes="48px" unoptimized className="object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.cardName}</p>
                    <p className="text-manila-3 text-[11px]">
                      {s.company} · {s.tierName} · fee {money(s.fee as Cents)}
                    </p>
                  </div>

                  {s.status === "queued" ? (
                    <div className="text-right">
                      <p className="t-eyebrow text-manila-3">In the queue</p>
                      <p className="t-num text-manila tabular-nums" aria-live="polite">
                        {formatCountdown(s.secondsRemaining)}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="text-right">
                        <p className="t-eyebrow text-manila-3">Grade</p>
                        <p className={cn("t-num tabular-nums", s.numericGrade === 10 ? "text-brass" : "text-manila")}>
                          {s.company} {s.numericGrade}
                        </p>
                        <p className="text-manila-3 text-[10px]">{s.label}</p>
                      </div>
                      <div className="text-right">
                        <p className="t-eyebrow text-manila-3">Value</p>
                        <p className={cn(
                          "t-num tabular-nums",
                          (s.estimatedValue ?? 0) >= s.rawValue ? "text-gain" : "text-loss",
                        )}>
                          {money((s.estimatedValue ?? 0) as Cents)}
                        </p>
                        <p className="text-manila-3 text-[10px]">was {money(s.rawValue as Cents)}</p>
                      </div>
                      {s.status === "ready" && (
                        <button
                          type="button"
                          onClick={() => collect(s.id)}
                          className="bg-brass text-ink hover:bg-brass-hot shrink-0 rounded-pane px-3 py-2 text-xs font-semibold transition"
                        >
                          Collect
                        </button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
  </>
  );
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
