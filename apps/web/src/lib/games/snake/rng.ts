/** A pure Mulberry32 step, kept stateful only through the returned seed. */
export function rand(seed: number): { value: number; seed: number } {
  const t = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return { value: ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296, seed: t };
}

export function randInt(seed: number, maxExclusive: number) {
  const next = rand(seed);
  return { value: Math.floor(next.value * maxExclusive), seed: next.seed };
}

/** A stable 32-bit seed from the server-signed hexadecimal run seed. */
export function seedFromRun(seed: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash | 0;
}
