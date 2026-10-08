/**
 * Parity with the reference prototype: runs the prototype's own data and
 * simulation code (reference/ORBIT_prototype.html) and checks that the
 * TypeScript port produces the same holders, states, events and texts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateDemoSystem, type DemoHolder } from "./demo";
import { eventText } from "./events";

const NOW = Date.UTC(2026, 9, 8, 15, 30, 0);
const PROTOTYPE = fileURLToPath(
  new URL("../../../reference/ORBIT_prototype.html", import.meta.url),
);

interface ProtoHolder extends Record<string, unknown> {
  addr: string;
  S: Record<string, unknown> & { news: { day: number; k: string; p: Record<string, unknown> }[] };
}

function runPrototype() {
  const html = readFileSync(PROTOTYPE, "utf8");
  const from = html.indexOf("/* ================= CONFIG");
  const to = html.indexOf("/* ================= renderer");
  const src = html.slice(from, to);
  class FixedDate extends Date {
    constructor(...args: ConstructorParameters<typeof Date> | []) {
      if (args.length) super(...(args as ConstructorParameters<typeof Date>));
      else super(NOW);
    }
    static override now() {
      return NOW;
    }
  }
  const run = new Function(
    "window",
    "localStorage",
    "Date",
    `${src}\nreturn { holders, newsText };`,
  ) as (
    w: unknown,
    ls: unknown,
    d: unknown,
  ) => {
    holders: ProtoHolder[];
    newsText: (e: unknown, h: unknown) => string;
  };
  return run({ __LANG: "en" }, undefined, FixedDate);
}

/** Prototype names are {en, ru} pairs; the port keeps only English strings. */
function englishOnly(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(englishOnly);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("en" in o && "ru" in o) return o.en;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) {
      if (k === "orig" || k === "mottoCustom") continue; // prototype-only customisation fields
      out[k] = englishOnly(x);
    }
    return out;
  }
  return v;
}

const STATE_KEYS = [
  "day",
  "k",
  "temp",
  "targetT",
  "tOff",
  "water",
  "waterMax",
  "atm",
  "atmMax",
  "icy",
  "life",
  "lifeDay",
  "bio",
  "civ",
  "civDay",
  "pop",
  "tech",
  "stab",
  "ash",
  "dim",
  "moons",
  "colonies",
  "finds",
  "news",
  "hist",
  "era",
  "sellIdx",
  "bible",
  "catCount",
  "soupBoost",
  "cont",
  "cities",
] as const;

function holderView(h: DemoHolder | ProtoHolder, ang: unknown) {
  const S = h.S as unknown as Record<string, unknown>;
  return englishOnly({
    addr: h.addr,
    name: h.name,
    days: h.days,
    bal: h.bal,
    buys: h.buys,
    sells: h.sells,
    start: h.start,
    rank: h.rank,
    timeRank: h.timeRank,
    orbit: h.orbit,
    incl: h.incl,
    node: h.node,
    ang,
    og: h.og,
    cls: h.cls,
    size: h.size,
    sizeBonus: h.sizeBonus,
    rings: h.rings,
    S: Object.fromEntries(STATE_KEYS.map((k) => [k, S[k]])),
  });
}

describe("prototype parity", () => {
  const proto = runPrototype();
  const port = generateDemoSystem(NOW);

  it("generates the same holders in the same order", () => {
    expect(port.holders.map((h) => h.addr)).toEqual(proto.holders.map((h) => h.addr));
  });

  it("produces identical holder data and simulation state", () => {
    port.holders.forEach((h, i) => {
      const p = proto.holders[i]!;
      expect(holderView(h, h.ang0)).toEqual(holderView(p, p.ang));
    });
  });

  it("writes identical English event texts", () => {
    let checked = 0;
    port.holders.forEach((h, i) => {
      const p = proto.holders[i]!;
      h.S.news.forEach((e, j) => {
        expect(eventText(e, { cls: h.cls, waterMax: h.S.waterMax })).toBe(
          proto.newsText(p.S.news[j], p),
        );
        checked++;
      });
    });
    expect(checked).toBeGreaterThan(5000);
  });
});
