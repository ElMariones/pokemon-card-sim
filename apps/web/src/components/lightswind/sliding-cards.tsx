"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export type CardContent = {
  id: string | number;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  bgClass?: string;
  // Pokémon card adaptation
  imageUrl?: string | null;
  name?: string;
  number?: string;
  value?: number;
  rarityTier?: string;
  isHit?: boolean;
  isReverse?: boolean;
};

type SlidingCardsProps = {
  cards: CardContent[];
  className?: string;
  cardSize?: string;
  centerIcon?: React.ReactNode;
  visibleRange?: number;
  onCardClick?: (index: number) => void;
};

const SlidingCards: React.FC<SlidingCardsProps> = ({
  cards,
  className = "",
  cardSize = "w-24 h-24",
  onCardClick,
}) => {
  const cardStackRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLElement[]>([]);

  // stable ref to onCardClick for inside handlers
  const onCardClickRef = useRef(onCardClick);
  useEffect(() => { onCardClickRef.current = onCardClick; }, [onCardClick]);

  useEffect(() => {
    const cardStack = cardStackRef.current;
    if (!cardStack) return;
    // capture initial order; do not re-capture on every parent re-render
    // so swipe-driven DOM reordering is not clobbered by React's reconcile
    if (cardsRef.current.length === 0) {
      cardsRef.current = Array.from(cardStack.querySelectorAll(".card")) as HTMLElement[];
    } else {
      // if cards length changed (new pack), re-capture
      const fresh = Array.from(cardStack.querySelectorAll(".card")) as HTMLElement[];
      if (fresh.length !== cardsRef.current.length) cardsRef.current = fresh;
    }

    let isSwiping = false;
    let startX = 0;
    let currentX = 0;
    let animationFrameId: number | null = null;

    const getDuration = () => 300;
    const getActiveCard = () => cardsRef.current[0];

    const updatePositions = () => {
      cardsRef.current.forEach((card, i) => {
        const offset = i + 1;
        card.style.zIndex = `${100 - offset}`;
        card.style.transform = `perspective(700px) translateZ(${-12 * offset}px) translateY(${7 * offset}px) translateX(0px) rotateY(0deg)`;
        card.style.opacity = `1`;
      });
    };

    const applySwipeStyles = (deltaX: number) => {
      const card = getActiveCard();
      if (!card) return;
      const rotate = deltaX * 0.2;
      const opacity = 1 - Math.min(Math.abs(deltaX) / 100, 1) * 0.75;
      card.style.transform = `perspective(700px) translateZ(-12px) translateY(7px) translateX(${deltaX}px) rotateY(${rotate}deg)`;
      card.style.opacity = `${opacity}`;
    };

    const handleStart = (clientX: number) => {
      if (isSwiping) return;
      isSwiping = true;
      startX = currentX = clientX;
      const card = getActiveCard();
      card && (card.style.transition = "none");
    };

    const handleMove = (clientX: number) => {
      if (!isSwiping) return;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(() => {
        currentX = clientX;
        const deltaX = currentX - startX;
        applySwipeStyles(deltaX);
        if (Math.abs(deltaX) > 50) handleEnd();
      });
    };

    const handleEnd = () => {
      if (!isSwiping) return;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);

      const deltaX = currentX - startX;
      const threshold = 50;
      const duration = getDuration();
      const card = getActiveCard();

      if (card) {
        card.style.transition = `transform ${duration}ms ease, opacity ${duration}ms ease`;

        if (Math.abs(deltaX) > threshold) {
          const direction = Math.sign(deltaX);
          card.style.transform = `perspective(700px) translateZ(-12px) translateY(7px) translateX(${direction * 300}px) rotateY(${direction * 20}deg)`;

          setTimeout(() => {
            card.style.transform = `perspective(700px) translateZ(-12px) translateY(7px) translateX(${direction * 300}px) rotateY(${-direction * 20}deg)`;
          }, duration / 2);

          setTimeout(() => {
            cardsRef.current = [...cardsRef.current.slice(1), card];
            updatePositions();
            // notify parent that top card was swiped away
            onCardClickRef.current?.(0);
          }, duration);
        } else {
          applySwipeStyles(0);
        }
      }

      isSwiping = false;
      startX = currentX = 0;
    };

    const onPointerDown = (e: PointerEvent) => handleStart(e.clientX);
    const onPointerMove = (e: PointerEvent) => handleMove(e.clientX);
    const onPointerUp = () => handleEnd();

    cardStack.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    // touch events for mobile fallback
    cardStack.addEventListener("touchstart", (e) => handleStart(e.touches[0].clientX), { passive: true } as any);
    window.addEventListener("touchmove", (e: TouchEvent) => handleMove(e.touches[0].clientX) as any, { passive: true } as any);
    window.addEventListener("touchend", onPointerUp);

    updatePositions();

    return () => {
      cardStack.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [cards.length]);

  return (
    <section
      ref={cardStackRef}
      className={cn(
        "relative w-64 h-[22rem] grid place-content-center touch-none select-none",
        className
      )}
    >
      {cards.map(({ id, icon, bgClass = "bg-gradient-to-br from-pink-300 to-orange-200", imageUrl, name, number, isHit }, index) => (
        <article
          key={id}
          onClick={() => onCardClick?.(index)}
          className={cn(
            "card absolute inset-4 grid place-content-center rounded-xl border border-gray-400/20 shadow-xl cursor-grab transition-transform ease-in-out overflow-hidden",
            // if we have a pokemon image, remove bg gradient and make it card-like
            imageUrl ? "bg-vitrine-2 border-seam p-0" : bgClass
          )}
        >
          {imageUrl ? (
            <div className="w-full h-full relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={name ?? ""}
                className="w-full h-full object-cover rounded-xl"
                draggable={false}
              />
              {/* subtle hit glow */}
              {isHit && (
                <div className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-brass/60 shadow-[0_0_20px_rgba(211,160,60,0.5)]" />
              )}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                <p className="text-white text-xs font-semibold truncate">{name}{number ? ` #${number}` : ""}</p>
              </div>
            </div>
          ) : (
            <span className={cn("aspect-square grid place-content-center", cardSize)}>
              {icon || (
                <svg
                  className="w-full h-full fill-white drop-shadow-md"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                >
                  <circle cx="8" cy="8" r="6" />
                </svg>
              )}
            </span>
          )}
        </article>
      ))}
    </section>
  );
};

export default SlidingCards;
