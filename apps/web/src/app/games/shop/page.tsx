"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import { usePlayer } from "@/components/PlayerProvider";
import type { Cents } from "@pcs/shared";
import type { Cosmetic, MinigameId } from "@pcs/minigame-engine";
import { CosmeticPreview, paletteVars } from "@/components/games/CosmeticArt";

interface CosmeticView extends Cosmetic {
  owned: boolean;
  equipped: boolean;
}

interface ArcadeView {
  cosmetics: CosmeticView[];
}

const SECTIONS: { game: MinigameId; title: string; note: string }[] = [
  { game: "flappy", title: "Who you fly as", note: "Flappy Pokémon. Purely who you are — none of them fly better." },
  { game: "snake", title: "Where you slither", note: "PokéSnake. Pikachu always leads; the field is just a field." },
  { game: "match", title: "The back of the card", note: "Card Match. Twelve of these, face down — the genuine blue back until you buy your way off it." },
  { game: "type", title: "What you type over", note: "Speed Type. The art behind the passage, kept dim enough to read through." },
];

export default function ShopPage() {
  const { player, setCash, refresh } = usePlayer();
  const [view, setView] = useState<ArcadeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await fetch("/api/minigames")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (data) setView(data);
    else setError("Could not load the shop");
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const act = async (path: string, cosmeticId: string) => {
    setBusy(cosmeticId);
    setError(null);

    const res = await fetch(`/api/minigames/shop/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cosmeticId }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error ?? "Could not complete that");
      setBusy(null);
      return;
    }

    if (data.balanceAfter != null) setCash(data.balanceAfter);
    await load();
    void refresh();
    setBusy(null);
  };

  const cash = player?.cash ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <Link
        href="/games"
        scroll={false}
        className="text-manila-2 hover:text-manila mb-6 inline-flex items-center gap-2 text-sm transition"
      >
        <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.8} />
        Back to the arcade
      </Link>

      {error && (
        <p role="alert" className="text-loss ring-loss/40 mb-6 rounded-pane px-4 py-3 text-sm ring-1">
          {error}
        </p>
      )}

      <h1 className="t-display mb-1 text-2xl tracking-tight">Shop</h1>
      <p className="text-manila-2 mb-8 max-w-2xl text-sm">
        Everything here is decoration. Nothing you buy pays better, flies further, or makes a
        board easier — it only changes what you are looking at while you earn.
      </p>

      {loading && <p className="text-manila-3 pane p-6 text-sm">Opening the case…</p>}

      {view &&
        SECTIONS.map(({ game, title, note }) => {
          const items = view.cosmetics.filter((c) => c.game === game);
          if (items.length === 0) return null;

          return (
            <section key={game} className="mb-10">
              <h2 className="t-eyebrow mb-1">{title}</h2>
              <p className="text-manila-3 mb-4 text-xs">{note}</p>

              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((item) => {
                  const affordable = item.owned || cash >= item.price;
                  const shortfall = item.price - cash;
                  const working = busy === item.id;

                  return (
                    <li
                      key={item.id}
                      className={cn("pane cosmetic flex flex-col", item.equipped && "cosmetic--equipped")}
                      style={paletteVars(item.palette)}
                    >
                      <div className="cosmetic__swatch">
                        <CosmeticPreview cosmetic={item} owned={item.owned} />
                      </div>

                      <div className="flex flex-1 flex-col p-4">
                        <div className="mb-3 flex items-baseline justify-between gap-3">
                          <h3 className="text-manila text-sm font-medium">{item.name}</h3>
                          {item.price > 0 && !item.owned && (
                            <p className="t-num text-brass shrink-0 text-sm tabular-nums">
                              {money(item.price as Cents)}
                            </p>
                          )}
                        </div>

                        <p className="text-manila-3 mb-4 flex-1 text-xs leading-snug">{item.blurb}</p>

                        {item.equipped ? (
                          <p className="t-eyebrow text-manila-2 rounded-pane bg-vitrine-3 px-3 py-2 text-center leading-none">
                            Equipped
                          </p>
                        ) : item.owned ? (
                          <button
                            type="button"
                            onClick={() => act("equip", item.id)}
                            disabled={working}
                            className="ring-seam text-manila hover:bg-vitrine-3 rounded-pane px-3 py-2 text-xs ring-1 transition disabled:opacity-50"
                          >
                            {working ? "Equipping…" : "Equip"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => act("buy", item.id)}
                            disabled={!affordable || working}
                            className={cn(
                              "rounded-pane px-3 py-2 text-xs transition",
                              affordable
                                ? "bg-brass-dim text-manila hover:bg-brass hover:text-ink"
                                : "text-manila-3 ring-seam cursor-not-allowed ring-1",
                            )}
                          >
                            {working
                              ? "Buying…"
                              : affordable
                                ? "Buy"
                                : `${money(shortfall as Cents)} short`}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
    </div>
  );
}
