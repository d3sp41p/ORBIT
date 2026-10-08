/**
 * Deterministic random numbers, ported unchanged from the prototype
 * (xmur3 string hash + mulberry32). The generator exposes its internal
 * state so the server can persist it and resume the same sequence.
 */

export interface Rng {
  (): number;
  /** Internal 32-bit state; restoring it resumes the exact sequence. */
  state: number;
}

export function xmur3(s: string): () => number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function mulberry32(seed: number): Rng {
  const next = (() => {
    let a = next.state | 0;
    a = (a + 0x6d2b79f5) | 0;
    next.state = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.state = seed | 0;
  return next;
}

export const rngFor = (s: string): Rng => mulberry32(xmur3(s)());

export const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
export const pickI = (r: () => number, n: number): number => Math.floor(r() * n);
