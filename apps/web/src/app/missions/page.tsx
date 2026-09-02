"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { usePlayer } from "@/components/PlayerProvider";
import { usePreservedScroll } from "@/lib/nav-state";
import type { Cents } from "@pcs/shared";

interface Mission {
  id: string; title: string; cadence: string; target: number;
  progress: number; complete: boolean; claimed: boolean;
  rewardCash: number; rewardXp: number;
}
interface Progression {
  xp: number; level: number; title: string; nextTitle: string | null;
  xpToNext: number | null; progressBp: number; unlocks: string[];
  missions: { daily: Mission[]; weekly: Mission[]; long_term: Mission[] };
}

const CADENCE_LABEL: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  long_term: "Long term",
};

export default function MissionsPage() {
  const { refresh, setCash: setHeaderCash } = usePlayer();
  usePreservedScroll();
  const [prog, setProg] = useState<Progression | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const p = await fetch("/api/progression")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (p) setProg(p);
    else setError("Could not load your missions");
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const claim = async (missionId: string) => {
    setError(null);
    const res = await fetch("/api/progression/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missionId }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Could not claim"); return; }
    if (data.balanceAfter != null) setHeaderCash(data.balanceAfter);
    await load();
    void refresh();
  };

  return (
    <>

      <div className="mx-auto max-w-7xl px-5 py-8">
        {error && (
          <p role="alert" className="text-loss ring-loss/40 mb-6 rounded-pane px-4 py-3 text-sm ring-1">
            {error}
          </p>
        )}

        <h1 className="t-display mb-1 text-2xl tracking-tight">Missions</h1>
        <p className="text-manila-2 mb-8 max-w-2xl text-sm">
          Completing a set is worth more than two hundred packs. That is deliberate — the
          fastest way up is to finish what you started, not to keep buying.
        </p>

        {loading && (
          <p className="text-manila-3 pane p-6 text-sm">Reading your missions…</p>
        )}

        {prog &&
          (["daily", "weekly", "long_term"] as const).map((cadence) => {
            const list = prog.missions[cadence] ?? [];
            if (list.length === 0) return null;
            return (
              <section key={cadence} className="mb-8">
                <h2 className="t-eyebrow text-manila-3 mb-3">{CADENCE_LABEL[cadence]}</h2>
                <ul className="space-y-2">
                  {list.map((m) => (
                    <li key={m.id} className="pane flex items-center gap-4 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{m.title}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="bg-vitrine-3 h-1 max-w-[14rem] flex-1 overflow-hidden rounded-full">
                            <div
                              className={cn(
                                "h-full rounded-full transition-[width] duration-500",
                                m.complete ? "bg-brass" : "bg-brass-dim",
                              )}
                              style={{ width: `${Math.min(100, (m.progress / m.target) * 100)}%` }}
                            />
                          </div>
                          <span className="t-mono text-manila-3 text-[11px] tabular-nums">
                            {m.progress} / {m.target}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="t-num text-brass text-sm tabular-nums">
                          {money(m.rewardCash as Cents)}
                        </p>
                        <p className="text-manila-3 t-mono text-[11px]">+{m.rewardXp} xp</p>
                      </div>

                      {m.claimed ? (
                        <span className="text-manila-3 shrink-0 rounded-pane px-3 py-2 text-xs uppercase">
                          Claimed
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={!m.complete}
                          onClick={() => claim(m.id)}
                          className={cn(
                            "shrink-0 rounded-pane px-3 py-2 text-xs font-semibold transition",
                            m.complete
                              ? "bg-brass text-ink hover:bg-brass-hot"
                              : "text-manila-3 ring-seam cursor-not-allowed ring-1",
                          )}
                        >
                          {m.complete ? "Claim" : "Locked"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
      </div>
  </>
  );
}
