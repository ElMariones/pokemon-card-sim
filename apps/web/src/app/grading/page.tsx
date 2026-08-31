"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { usePlayer } from "@/components/PlayerProvider";
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

export default function GradingPage() {
  const { player, refresh, setCash: setHeaderCash } = usePlayer();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [owned, setOwned] = useState<OwnedCard[]>([]);
  const [picked, setPicked] = useState<OwnedCard | null>(null);
  const [cash, setCash] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const effectiveCash = player?.cash ?? cash;

  const load = useCallback(async () => {
    const [g, c, me] = await Promise.all([
      fetch("/api/grading").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/collection?pageSize=100").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/me").then((r) => (r.ok ? r.json() : null)),
    ]);
    if (g) { setSubmissions(g.submissions ?? []); setTiers(g.tiers ?? []); }
    if (c) setOwned(c.items ?? []);
    if (me) setCash(me.player?.cash ?? null);
  }, []);

  useEffect(() => { void load(); }, [load]);

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

  const submit = async (tierId: string) => {
    if (!picked) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/grading/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryId: picked.inventoryId, serviceTierId: tierId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not submit"); return; }
      if (data.balanceAfter != null) setHeaderCash(data.balanceAfter);
      setPicked(null);
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

  const affordable = (t: Tier) =>
    effectiveCash !== null && effectiveCash >= t.fee &&
    (!picked || (picked.marketBasePrice ?? 0) <= t.maxDeclaredValue);

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
            that is the whole decision.
          </p>

          <div className="pane p-5">
            <p className="t-eyebrow text-manila-3 mb-3">
              {picked ? "Choose a service" : "Choose a card to submit"}
            </p>

            {!picked ? (
              owned.length === 0 ? (
                <p className="text-manila-3 text-sm">
                  Nothing to grade yet. <Link href="/" className="text-brass underline">Open a pack.</Link>
                </p>
              ) : (
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-10">
                  {[...owned]
                    .sort((a, b) => (b.marketBasePrice ?? 0) - (a.marketBasePrice ?? 0))
                    .slice(0, 20)
                    .map((c) => (
                      <li key={c.inventoryId}>
                        <button
                          type="button"
                          onClick={() => setPicked(c)}
                          className="group w-full text-left focus-visible:outline-2 focus-visible:outline-brass rounded-[8px]"
                        >
                          <div className="ring-seam relative aspect-[2.5/3.5] overflow-hidden rounded-[8px] ring-1 transition group-hover:ring-brass">
                            {c.imageSmall && (
                              <Image src={c.imageSmall} alt="" fill sizes="110px" unoptimized className="object-cover" />
                            )}
                          </div>
                          <p className="text-manila-2 mt-1 truncate text-[11px]">{c.name}</p>
                          <p className="t-num text-manila-3 text-[11px] tabular-nums">
                            {money((c.marketBasePrice ?? 0) as Cents)}
                          </p>
                        </button>
                      </li>
                    ))}
                </ul>
              )
            ) : (
              <div className="flex flex-col gap-5 sm:flex-row">
                <div className="w-32 shrink-0">
                  <div className="ring-brass relative aspect-[2.5/3.5] overflow-hidden rounded-[8px] ring-1">
                    {picked.imageSmall && (
                      <Image src={picked.imageSmall} alt="" fill sizes="128px" unoptimized className="object-cover" />
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-[12px]">{picked.name}</p>
                  <p className="t-num text-manila-3 text-[11px] tabular-nums">
                    raw {money((picked.marketBasePrice ?? 0) as Cents)}
                  </p>
                  <button
                    type="button"
                    onClick={() => setPicked(null)}
                    className="text-manila-3 hover:text-manila mt-1 text-[11px] underline"
                  >
                    Choose another
                  </button>
                </div>

                <ul className="grid flex-1 gap-2 sm:grid-cols-2">
                  {tiers.map((t) => {
                    const ok = affordable(t);
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          disabled={!ok || busy}
                          onClick={() => submit(t.id)}
                          className={cn(
                            "ring-seam w-full rounded-pane p-3 text-left ring-1 transition",
                            ok ? "hover:ring-brass hover:bg-vitrine-2" : "cursor-not-allowed opacity-40",
                          )}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-medium">{t.name}</span>
                            <span className="t-num text-brass tabular-nums">{money(t.fee as Cents)}</span>
                          </div>
                          <p className="text-manila-3 mt-0.5 text-[11px]">
                            ~{Math.round(t.realSecondsToComplete / 60)} min · up to{" "}
                            {money(t.maxDeclaredValue as Cents)} declared
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
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
