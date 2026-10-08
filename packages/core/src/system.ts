import { BALANCE } from "./config";
import { lerp, TAU } from "./math";
import { rngFor } from "./rng";

export type PlanetClass = "super" | "gas" | "ice" | "rocky" | "asteroid";

/** Class by balance rank: 1 supergiant, 2-10 gas, 11-50 ice, 51-200 rocky, rest asteroids. */
export function classOf(rank: number): PlanetClass {
  return rank === 1
    ? "super"
    : rank <= 10
      ? "gas"
      : rank <= 50
        ? "ice"
        : rank <= 200
          ? "rocky"
          : "asteroid";
}

/** Planet radius in scene units by rank. */
export function sizeOf(rank: number): number {
  if (rank === 1) return 5.2;
  if (rank <= 10) return lerp(3.9, 2.7, (rank - 2) / 8);
  if (rank <= 50) return lerp(2.3, 1.5, (rank - 11) / 39);
  if (rank <= 200) return lerp(1.3, 0.5, Math.pow((rank - 51) / 149, 0.8));
  return 0.16 + rngFor("s" + rank)() * 0.12;
}

/** Stability and technology bonus: 1 for the last holder up to sizeBonusMax for #1. */
export function sizeBonusOf(rank: number, holdersCount: number): number {
  return 1 + (BALANCE.sizeBonusMax - 1) * (1 - Math.log(rank) / Math.log(holdersCount));
}

export interface OrbitParams {
  /** Orbit radius in scene units. */
  orbit: number;
  /** Orbit inclination and node, radians. */
  incl: number;
  node: number;
  /** Angle at mission epoch, radians. */
  ang0: number;
}

/**
 * Orbit from the time-held order: timeRank 1 (oldest holder) is closest to the star.
 * Radius = 34 + f^0.82 * 520 with a small per-wallet jitter, f = (timeRank-1)/(N-1).
 */
export function orbitOf(addr: string, timeRank: number, holdersCount: number): OrbitParams {
  const f = holdersCount > 1 ? (timeRank - 1) / (holdersCount - 1) : 0;
  const r = rngFor(addr + "o");
  const orbit = 34 + Math.pow(f, 0.82) * 520 + (r() - 0.5) * 5;
  const incl = (r() - 0.5) * 0.09;
  const node = r() * TAU;
  const ang0 = r() * TAU;
  return { orbit, incl, node, ang0 };
}

/** Angular speed on an orbit, radians per second. */
export const orbitSpeed = (orbit: number) => (7.5 / Math.pow(orbit / 34, 1.5)) * 0.05;

/** Planet year length in days and distance in AU (display only). */
export const yearDays = (orbit: number) => Math.round(88 * Math.pow(orbit / 34, 1.5));
export const auOf = (orbit: number) => ((orbit / 34) * 0.39).toFixed(2);

export interface StarTier {
  /** Upper market cap bound in USD (exclusive). */
  max: number;
  cls: "M" | "K" | "G" | "F" | "O";
  name: string;
  core: [number, number, number];
  edge: [number, number, number];
  glow: number;
}

export const STAR_TIERS: readonly StarTier[] = [
  {
    max: 1e5,
    cls: "M",
    name: "Red dwarf",
    core: [1, 0.62, 0.4],
    edge: [0.75, 0.18, 0.08],
    glow: 0xff7044,
  },
  {
    max: 1e6,
    cls: "K",
    name: "Orange dwarf",
    core: [1, 0.8, 0.52],
    edge: [0.9, 0.38, 0.12],
    glow: 0xff9a50,
  },
  {
    max: 1e7,
    cls: "G",
    name: "Yellow dwarf",
    core: [1, 0.95, 0.82],
    edge: [1, 0.62, 0.2],
    glow: 0xffc070,
  },
  {
    max: 1e8,
    cls: "F",
    name: "White star",
    core: [1, 1, 0.96],
    edge: [1, 0.86, 0.62],
    glow: 0xfff0dc,
  },
  {
    max: Infinity,
    cls: "O",
    name: "Blue giant",
    core: [0.92, 0.96, 1],
    edge: [0.45, 0.62, 1],
    glow: 0x9ec0ff,
  },
];

export const starTierIndex = (mcap: number) => STAR_TIERS.findIndex((s) => mcap < s.max);
