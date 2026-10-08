/**
 * Demo data: the prototype's fake holder generator. Used by the site until
 * real holders come from the chain (stage 4-5). Same seed, same holders.
 */
import { BALANCE } from "./config";
import { clamp, DAY_MS } from "./math";
import { planetName } from "./names";
import { mulberry32 } from "./rng";
import {
  initSim,
  simulateTo,
  type Sell,
  type SimContext,
  type SimHolder,
  type SimState,
} from "./sim";
import {
  classOf,
  orbitOf,
  sizeBonusOf,
  sizeOf,
  type OrbitParams,
  type PlanetClass,
} from "./system";

export const DEMO = {
  name: "ORBIT",
  ticker: "ORBIT",
  contract: "ORBiTx9m2VqZcF7hKpL4sNw8rYdT3eGuB6jHaQ5pump",
  supply: 1_000_000_000,
  launch: Date.UTC(2026, 3, 25, 12, 0, 0),
  mcap: 1_840_000,
  holders: 650,
  seed: 20261008,
} as const;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function randAddr(r: () => number) {
  let s = "";
  for (let i = 0; i < 44; i++) s += B58[Math.floor(r() * 58)];
  return s;
}

export interface DemoHolder extends SimHolder, OrbitParams {
  name: string;
  /** Days held. */
  days: number;
  bal: number;
  buys: number;
  sells: Sell[];
  /** Hold start, ms since epoch. */
  start: number;
  rank: number;
  timeRank: number;
  og: boolean;
  cls: PlanetClass;
  size: number;
  sizeBonus: number;
  S: SimState;
  rings: boolean;
}

export interface DemoSystem {
  holders: DemoHolder[];
  ctx: SimContext;
  now: number;
}

/** Generate the demo system and simulate every planet up to `now`. */
export function generateDemoSystem(now: number, count: number = DEMO.holders): DemoSystem {
  const world = mulberry32(DEMO.seed);
  const age = (now - DEMO.launch) / DAY_MS;
  const raw: Omit<
    DemoHolder,
    keyof OrbitParams | "rank" | "timeRank" | "og" | "cls" | "size" | "sizeBonus" | "S" | "rings"
  >[] = [];
  for (let i = 0; i < count; i++) {
    const addr = randAddr(world);
    const days = Math.max(0.03, age * Math.pow(world(), 1.6));
    const bal = clamp(90000 / Math.pow(world(), 1.25), 60000, 42000000);
    const buys = 1 + Math.floor(Math.pow(world(), 2) * 9);
    const sells: Sell[] = [];
    if (world() < 0.35 && days > 2) {
      const n = 1 + Math.floor(world() * 3);
      for (let k = 0; k < n; k++)
        sells.push({ frac: 0.01 + Math.pow(world(), 1.6) * 0.6, at: world() * days });
    }
    sells.sort((a, b) => a.at - b.at);
    raw.push({ addr, name: planetName(addr), days, bal, buys, sells, start: now - days * DAY_MS });
  }
  const holders = raw as DemoHolder[];
  holders.sort((a, b) => b.bal - a.bal).forEach((h, i) => (h.rank = i + 1));
  const N = holders.length;
  [...holders]
    .sort((a, b) => b.days - a.days)
    .forEach((h, i) => {
      h.timeRank = i + 1;
      Object.assign(h, orbitOf(h.addr, h.timeRank, N));
      h.og = i < 50;
    });
  for (const h of holders) {
    h.cls = classOf(h.rank);
    h.size = sizeOf(h.rank);
    h.sizeBonus = sizeBonusOf(h.rank, N);
    h.S = initSim(h);
  }
  const ctx: SimContext = { neighbors: holders };
  for (const h of holders) simulateTo(h.S, h, h.days, ctx);
  for (const h of holders) h.rings = hasRings(h);
  return { holders, ctx, now };
}

/** Rings after ringsAfterDays without a counted sell (rocky worlds only in the top 120). */
export function hasRings(h: Pick<DemoHolder, "cls" | "days" | "sells" | "rank">): boolean {
  return (
    h.cls !== "asteroid" &&
    h.days >= BALANCE.ringsAfterDays &&
    h.sells.filter((s) => s.counted).length === 0 &&
    (h.cls !== "rocky" || h.rank <= 120)
  );
}
