/** Seeded PRNG for deterministic demo-data generation. mulberry32 — small,
 *  fast, no dependencies, good enough distribution for flavor data. Given the
 *  same seed it always produces the same sequence, which is what keeps the
 *  generator (and its tests) deterministic. */
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
