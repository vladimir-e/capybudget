/** FNV-1a hash of a string as an unsigned 32-bit Rng seed. Distinct inputs
 *  (e.g. profile ids) get distinct, stable seeds — the same input always
 *  reproduces the same random texture. */
export function seedFromString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Seeded PRNG (mulberry32): same seed → same sequence, which is what keeps the
 *  generator deterministic. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Coerce to a 32-bit unsigned integer so a 0 or float seed still advances.
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  nextFloat(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive on both ends. */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }

  /** A uniformly chosen element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[this.nextInt(0, items.length - 1)];
  }

  /** True with probability `p` (in [0, 1]). */
  chance(p: number): boolean {
    return this.nextFloat() < p;
  }

  /** `base` perturbed by up to ±`pct` (e.g. 0.1 → ±10%), rounded to an
   *  integer so cent amounts stay whole. */
  jitter(base: number, pct: number): number {
    const factor = 1 + (this.nextFloat() * 2 - 1) * pct;
    return Math.round(base * factor);
  }
}
