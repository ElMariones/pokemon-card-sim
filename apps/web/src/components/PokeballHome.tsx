"use client";

import Image from "next/image";
import Link from "next/link";

export function PokeballHome({ active }: { active: boolean }) {
  return (
    <Link
      href="/"
      scroll={false}
      aria-label="Packs home"
      aria-current={active ? "page" : undefined}
      className="pokeball-home group"
    >
      <span className="pokeball-home__orbit" aria-hidden="true" />
      <span className="pokeball-home__halo" aria-hidden="true" />
      <Image
        src="/pokeball.svg"
        alt=""
        width={42}
        height={42}
        priority
        className="pokeball-home__ball"
      />
      <span className="pokeball-home__spark pokeball-home__spark--one" aria-hidden="true" />
      <span className="pokeball-home__spark pokeball-home__spark--two" aria-hidden="true" />
    </Link>
  );
}
