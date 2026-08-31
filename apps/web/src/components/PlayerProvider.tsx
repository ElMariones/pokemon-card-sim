"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from "react";
import type { Cents } from "@pcs/shared";

/**
 * Session state, held once for the whole app.
 *
 * Each page used to fetch the player itself and render its own header, so cash
 * and level flickered or vanished on every navigation and the header appeared
 * to "hide". Holding it here means the shell is continuous across routes and a
 * page only asks for what is specific to it.
 */

export interface Player {
  id: string;
  cash: Cents;
  xp: number;
  level: number;
  albumCapacity: number;
  displayName: string | null;
}

export interface Progression {
  level: number;
  title: string;
  progressBp: number;
  xpToNext: number | null;
  xp: number;
}

interface PlayerContextValue {
  player: Player | null;
  progression: Progression | null;
  collectionCount: number;
  loading: boolean;
  /** Re-read everything the shell shows. Call after any action that spends. */
  refresh: () => Promise<void>;
  /** Optimistic balance update, so a purchase lands instantly. */
  setCash: (cash: Cents) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [progression, setProgression] = useState<Progression | null>(null);
  const [collectionCount, setCollectionCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // /api/me establishes the session cookie and every other endpoint needs
    // it, so it is awaited before the rest rather than raced against them.
    const me = await fetch("/api/me").then((r) => (r.ok ? r.json() : null));
    if (me?.player) setPlayer(me.player);

    const [prog, stats] = await Promise.all([
      fetch("/api/progression").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/collection/stats").then((r) => (r.ok ? r.json() : null)),
    ]);
    if (prog) setProgression(prog);
    if (stats) setCollectionCount(stats.totalCopies ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Keep header cash fresh even if a page forgot to call refresh().
  // Polling and focus refresh are cheap and paper over missed calls.
  useEffect(() => {
    const onFocus = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    // Custom event any mutating component can dispatch as a safety net
    const onCustom = () => { void refresh(); };
    window.addEventListener("pcs:refresh" as never, onCustom as never);
    const id = setInterval(() => { void refresh(); }, 15000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pcs:refresh" as never, onCustom as never);
      clearInterval(id);
    };
  }, [refresh]);

  const setCash = useCallback((cash: Cents) => {
    setPlayer((p) => (p ? { ...p, cash } : p));
  }, []);

  const value = useMemo(
    () => ({ player, progression, collectionCount, loading, refresh, setCash }),
    [player, progression, collectionCount, loading, refresh, setCash],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}
