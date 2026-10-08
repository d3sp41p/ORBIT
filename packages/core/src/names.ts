import { pick, rngFor } from "./rng";
import { SY, SYL } from "./words";

/** Procedural name from SY syllables. Consumes the generator exactly like the prototype. */
export function nameGen(r: () => number, min = 2, max = 3): string {
  const n = min + Math.floor(r() * (max - min + 1));
  let s = "";
  for (let i = 0; i < n; i++) s += pick(r, SY);
  return s[0]!.toUpperCase() + s.slice(1);
}

/** Stock planet name derived from the wallet address. */
export function planetName(addr: string): string {
  const r = rngFor(addr + "n");
  const n = 2 + Math.floor(r() * 2);
  let s = "";
  for (let i = 0; i < n; i++) s += SYL[Math.floor(r() * SYL.length)];
  return s[0]!.toUpperCase() + s.slice(1) + " " + addr.slice(0, 3).toUpperCase();
}
