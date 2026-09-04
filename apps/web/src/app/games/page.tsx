"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Store } from "lucide-react";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ArcadeCabinet } from "@/components/games/ArcadeCabinet";
import type { Cents } from "@pcs/shared";
import type { Cosmetic, MinigameId } from "@pcs/minigame-engine";
import { CardBack, TypeBackdrop } from "@/components/games/CosmeticArt";

interface CosmeticView extends Cosmetic {
  owned: boolean;
  equipped: boolean;
}

interface GameView {
  game: MinigameId;
  best: number;
  earnedToday: number;
  playsToday: number;
}

interface ArcadeView {
  games: GameView[];
  cosmetics: CosmeticView[];
  earnedToday: number;
  capRemaining: number;
  dailyCap: number;
}

const MACHINES: Record<MinigameId, {
  name: string; href: string; tagline: string; scoring: string; bestLabel: string;
}> = {
  flappy: {
    name: "Flappy Pokémon",
    href: "/games/flappy",
    tagline: "One button. Do not hit the boxes.",
    scoring: "Pays per box cleared, and more the further you get.",
    bestLabel: "Best run",
  },
  match: {
    name: "Card Match",
    href: "/games/match",
    tagline: "Twelve pairs, face down. Remember where they were.",
    scoring: "Pays on a clean board. Moves cost more than seconds.",
    bestLabel: "Best board",
  },
  snake: {
    name: "Pokémon Parade",
    href: "/games/snake",
    tagline: "Snake, but the snake is a queue of Pokémon.",
    scoring: "Pays per point. A Pokémon joining is ten; a berry is four.",
    bestLabel: "Best parade",
  },
  type: {
    name: "Speed Type",
    href: "/games/type",
    tagline: "Type the passage. Mistakes do not count.",
    scoring: "Pays per correct character.",
    bestLabel: "Best characters",
  },
};

/** The order they stand on the floor. */
const FLOOR: MinigameId[] = ["flappy", "snake", "match", "type"];

export default function GamesPage() {
  const [view, setView] = useState<ArcadeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await fetch("/api/minigames")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (data) setView(data);
    else setError("Could not load the arcade");
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const equippedFor = (game: MinigameId) =>
    view?.cosmetics.find((c) => c.game === game && c.equipped);

  const spentBp = view && view.dailyCap > 0
    ? Math.min(100, (view.earnedToday / view.dailyCap) * 100)
    : 0;
  const spent = (view?.capRemaining ?? 1) <= 0;

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      {error && (
        <p role="alert" className="text-loss ring-loss/40 mb-6 rounded-pane px-4 py-3 text-sm ring-1">
          {error}
        </p>
      )}

      <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="t-display mb-1 text-2xl tracking-tight">Arcade</h1>
          <p className="text-manila-2 max-w-xl text-sm">
            Four machines in the corner of the shop. They pay real money into the same
            wallet that buys packs — capped, so the arcade stays a side income rather than
            a better one.
          </p>
        </div>

        <Link
          href="/games/shop"
          scroll={false}
          className="ring-seam text-manila hover:bg-vitrine-3 inline-flex items-center gap-2 rounded-pane px-4 py-2.5 text-sm ring-1 transition"
        >
          <Store aria-hidden="true" size={15} strokeWidth={1.8} />
          Shop
        </Link>
      </header>

      {/* The day's allowance. The one number that explains the whole economy. */}
      <section className="pane mb-8 p-4" aria-label="Today's allowance">
        <div className="mb-2.5 flex items-baseline justify-between gap-4">
          <p className="t-eyebrow leading-none">Today&rsquo;s allowance</p>
          <p className="t-num text-sm leading-none tabular-nums">
            <span className={spent ? "text-manila-3" : "text-brass"}>
              {money((view?.earnedToday ?? 0) as Cents)}
            </span>
            <span className="text-manila-3"> of {money((view?.dailyCap ?? 0) as Cents)}</span>
          </p>
        </div>
        <div className="credit-meter">
          <div
            className={cn("credit-meter__fill", spent && "credit-meter__fill--spent")}
            style={{ width: `${spentBp}%` }}
          />
        </div>
        <p className="text-manila-3 mt-2.5 text-xs">
          {spent
            ? "Spent for today. Play on — scores still count, they just stop paying until midnight UTC."
            : `${money((view?.capRemaining ?? 0) as Cents)} left before midnight UTC.`}
        </p>
      </section>

      {loading && <p className="text-manila-3 pane p-6 text-sm">Warming up the machines…</p>}

      {view && (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {FLOOR.map((game) => {
            const machine = MACHINES[game];
            const stats = view.games.find((g) => g.game === game);
            const equipped = equippedFor(game);
            const palette = (equipped?.palette ?? ["#d3a03c", "#8a6a2a"]) as [string, string];

            return (
              <ArcadeCabinet
                key={game}
                href={machine.href}
                name={machine.name}
                tagline={machine.tagline}
                scoring={machine.scoring}
                bestLabel={machine.bestLabel}
                best={stats?.best ?? 0}
                earnedToday={(stats?.earnedToday ?? 0) as Cents}
                palette={palette}
                spent={spent}
                screen={<CabinetScreen game={game} cosmetic={equipped} />}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * What is on the machine's screen.
 *
 * Each one shows the thing the player has actually equipped, so the shop's
 * effect is visible from the floor without opening a game.
 */
function CabinetScreen({ game, cosmetic }: { game: MinigameId; cosmetic?: CosmeticView }) {
  if (game === "flappy") {
    return (
      <div className="cabinet-route absolute inset-0 grid place-items-center">
        <span className="inline-block -scale-x-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/sprites/pokemon/${cosmetic?.sprite ?? 16}.gif`}
            alt=""
            width={96}
            height={96}
            className="pixel sprite-bob h-16 w-16 object-contain"
          />
        </span>
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-around opacity-90">
          <span className="stack stack--bottom !relative !w-7" style={{ height: 34 }} />
          <span className="stack stack--bottom !relative !w-7" style={{ height: 52 }} />
          <span className="stack stack--bottom !relative !w-7" style={{ height: 24 }} />
        </div>
      </div>
    );
  }

  if (game === "snake") {
    // The leader at the front of a short line, all walking right.
    const followers = [133, 7, 39];
    return (
      <div className="cabinet-meadow absolute inset-0">
        <div className="absolute inset-x-0 bottom-[32%] flex items-end justify-center">
          {[...followers].reverse().map((dex, i) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={dex}
              src={`/sprites/pokemon/${dex}.gif`}
              alt=""
              width={96}
              height={96}
              className="pixel h-11 w-11 -scale-x-100 object-contain"
              style={{ marginRight: -6, opacity: 0.8 + i * 0.06 }}
            />
          ))}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/sprites/pokemon/${cosmetic?.sprite ?? 25}.gif`}
            alt=""
            width={96}
            height={96}
            className="pixel sprite-bob h-14 w-14 -scale-x-100 object-contain"
          />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/sprites/items/oran-berry.png"
          alt=""
          width={30}
          height={30}
          className="pixel absolute right-[14%] top-[22%] h-6 w-6"
        />
      </div>
    );
  }

  if (game === "match") {
    // Six of the back the player actually flips, one already turned over.
    return (
      <div className="absolute inset-0 grid grid-cols-3 content-center justify-items-center gap-2 p-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="block w-full" style={{ opacity: i === 2 ? 0.28 : 1 }}>
            <CardBack cosmetic={cosmetic} />
          </span>
        ))}
      </div>
    );
  }

  return (
    // Sized with h-full rather than `absolute inset-0`, because .type-surface
    // sets position: relative and would win the cascade against Tailwind's
    // .absolute — leaving a zero-height wrapper and nothing to paint into.
    //
    // The backdrop is also deliberately not a child of the grid: an absolutely
    // positioned grid item is laid out against its *grid area*, not the
    // container, so `inset: 0` there would size it to the one line of text.
    <div className="type-surface h-full w-full">
      <TypeBackdrop cosmetic={cosmetic} />
      <div className="absolute inset-0 grid place-items-center px-6">
        <p className="t-mono text-center text-[13px] leading-relaxed">
          <span style={{ color: "var(--cab)" }}>evolving sk</span>
          <span className="text-manila bg-white/10 rounded-[2px]">i</span>
          <span className="text-manila-3">es booster box</span>
        </p>
      </div>
    </div>
  );
}
