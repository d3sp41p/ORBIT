import { describe, expect, it } from "vitest";
import { DEMO, generateDemoSystem, type DemoHolder } from "./demo";
import { DAY_MS } from "./math";
import { applySell, initSim, simSeed, type SimContext, type SimHolder } from "./sim";
import { advance, loadState, saveState, TICK_MS, tickAt } from "./state";
import { sizeBonusOf, sizeOf } from "./system";

const NOW = Date.UTC(2026, 9, 8, 15, 30, 0);

const rocky = (addr: string, sells: SimHolder["sells"] = []): SimHolder => ({
  addr,
  cls: "rocky",
  orbit: 120,
  size: sizeOf(80),
  sizeBonus: sizeBonusOf(80, 650),
  sells,
});
const ctx: SimContext = { neighbors: [{ addr: "N1", name: "Neighbour A" }] };
const START = Date.UTC(2026, 5, 1);

/** JSON round trip, as through the database. */
const viaDb = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("determinism", () => {
  it("the same input gives the same history", () => {
    const run = () => {
      const h = rocky("Wallet111");
      const S = initSim(h);
      const r = advance(S, h, START, START + 400 * DAY_MS, ctx);
      return { events: r.events, saved: saveState(S) };
    };
    expect(run()).toEqual(run());
  });

  it("save and restore mid-way continues exactly the same history", () => {
    const end = START + 500 * DAY_MS;
    const sells = [
      { frac: 0.3, at: 120 },
      { frac: 0.05, at: 300 },
    ];

    const h1 = rocky("Wallet222", viaDb(sells));
    const S1 = initSim(h1);
    const whole = advance(S1, h1, START, end, ctx);

    const h2 = rocky("Wallet222", viaDb(sells));
    let S2 = initSim(h2);
    const first = advance(S2, h2, START, START + 200 * DAY_MS, ctx);
    S2 = loadState(viaDb(saveState(S2)));
    const second = advance(S2, h2, START, end, ctx);

    expect([...first.events, ...second.events]).toEqual(whole.events);
    expect(saveState(S2)).toEqual(saveState(S1));
    expect(second.nextTickAt).toBe(whole.nextTickAt);
  });

  it("catching up in batches gives the same result as in one go", () => {
    const end = START + 90 * DAY_MS;
    const a = rocky("Wallet333");
    const Sa = initSim(a);
    const all = advance(Sa, a, START, end, ctx).events;

    const b = rocky("Wallet333");
    const Sb = initSim(b);
    const parts = [];
    let r;
    do {
      r = advance(Sb, b, START, end, ctx, 50);
      parts.push(...r.events);
    } while (r.ticks === 50);
    expect(parts).toEqual(all);
  });
});

describe("lives", () => {
  it("life 1 keeps the prototype seed and a new life starts a different history", () => {
    expect(simSeed("ABC")).toBe("ABCsim");
    expect(simSeed("ABC", 1)).toBe("ABCsim");
    expect(simSeed("ABC", 2)).toBe("ABCsim2");
    const h = rocky("Wallet444");
    expect(saveState(initSim(h, 1))).toEqual(saveState(initSim(h)));
    expect(saveState(initSim(h, 2))).not.toEqual(saveState(initSim(h, 1)));
  });
});

describe("advance", () => {
  it("ticks every 4 hours from the start of the hold", () => {
    const h = rocky("Wallet555");
    const S = initSim(h);
    expect(TICK_MS).toBe(4 * 3_600_000);
    const r = advance(S, h, START, START + DAY_MS - 1, ctx);
    expect(r.ticks).toBe(6); // 0h, 4h, ... 20h
    expect(r.nextTickAt).toBe(tickAt(START, 6));
    expect(advance(S, h, START, START + DAY_MS - 1, ctx).ticks).toBe(0);
    expect(advance(S, h, START, START + DAY_MS, ctx).ticks).toBe(1);
  });

  it("applies a sell at the first tick after it", () => {
    const h = rocky("Wallet666", [{ frac: 0.25, at: 0.55 }]); // 13:12, between ticks
    const S = initSim(h);
    const r = advance(S, h, START, START + DAY_MS, ctx);
    const sell = r.events.find((e) => e.k === "sell");
    expect(sell?.day).toBeCloseTo(4 / 6); // applied at the 16:00 tick
    expect(sell?.p.f).toBe(25);
  });
});

describe("sell catastrophes", () => {
  const sellOf = (frac: number) => {
    const h = rocky("Wallet777");
    const S = initSim(h);
    const sell: SimHolder["sells"][number] = { frac, at: 0 };
    applySell(S, h, 1, sell);
    return { e: S.news.at(-1)!, counted: !!sell.counted, S };
  };

  it("ignores sells below 2% of the balance", () => {
    const { e, counted, S } = sellOf(0.015);
    expect(e.k).toBe("sellSmall");
    expect(counted).toBe(false);
    expect(S.catCount).toBe(0);
  });

  it.each([
    [0.02, 0],
    [0.09, 0],
    [0.1, 1],
    [0.29, 1],
    [0.3, 2],
    [0.59, 2],
    [0.6, 3],
    [0.99, 3],
    [1, 4],
  ])("a sell of %f is catastrophe type %i", (frac, c) => {
    const { e, counted } = sellOf(frac);
    expect(e.k).toBe("sell");
    expect(e.p.c).toBe(c);
    expect(counted).toBe(true);
  });

  it("a full sell is 'Planet destroyed' with the biggest rollback", () => {
    const small = sellOf(0.3).S;
    const full = sellOf(1).S;
    expect(full.stab).toBeLessThanOrEqual(small.stab);
    expect(full.bio).toBeLessThanOrEqual(small.bio);
  });
});

const finite = (h: DemoHolder) => {
  const S = h.S;
  const nums = [
    S.temp,
    S.water,
    S.atm,
    S.bio,
    S.pop,
    S.tech,
    S.stab,
    S.ash,
    S.dim,
    ...S.hist.flat(),
  ];
  return nums.every(Number.isFinite);
};

describe("1000 days of simulation", () => {
  const { holders } = generateDemoSystem(DEMO.launch + 1000 * DAY_MS);

  it("has no NaN or Infinity", () => {
    expect(holders.filter((h) => !finite(h)).map((h) => h.addr)).toEqual([]);
    for (const h of holders)
      for (const e of h.S.news)
        for (const v of Object.values(e.p))
          if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
  });

  it("keeps technology and population bounded", () => {
    const maxTech = Math.max(...holders.map((h) => h.S.tech));
    const maxPop = Math.max(...holders.map((h) => h.S.pop));
    expect(maxTech).toBeLessThan(20);
    expect(maxPop).toBeLessThan(1e13);
    for (const h of holders) {
      expect(h.S.stab).toBeGreaterThanOrEqual(0);
      expect(h.S.stab).toBeLessThanOrEqual(100);
      expect(h.S.bio).toBeGreaterThanOrEqual(0);
      expect(h.S.bio).toBeLessThanOrEqual(1);
    }
  });
});

describe("distribution on 650 holders (as in the prototype)", () => {
  const { holders } = generateDemoSystem(NOW);
  const rockyWorlds = holders.filter((h) => h.cls === "rocky");
  const eras = Array(8).fill(0) as number[];
  holders.forEach((h) => eras[h.S.era]!++);

  it("about a third of rocky worlds have no life", () => {
    const share = rockyWorlds.filter((h) => !h.S.life).length / rockyWorlds.length;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.45);
  });

  it("only a few worlds reach the Megastructure era", () => {
    expect(eras[7]).toBeGreaterThan(0);
    expect(eras[7]).toBeLessThan(15);
  });

  it("rare finds on about 7% of worlds", () => {
    const share = holders.filter((h) => h.S.finds.length > 0).length / holders.length;
    expect(share).toBeGreaterThan(0.04);
    expect(share).toBeLessThan(0.1);
  });
});
