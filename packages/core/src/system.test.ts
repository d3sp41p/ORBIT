import { describe, expect, it } from "vitest";
import { esc } from "./format";
import { mulberry32, rngFor } from "./rng";
import { classOf, orbitOf, sizeOf, starTierIndex, STAR_TIERS } from "./system";

describe("classOf / sizeOf", () => {
  it.each([
    [1, "super"],
    [2, "gas"],
    [10, "gas"],
    [11, "ice"],
    [50, "ice"],
    [51, "rocky"],
    [200, "rocky"],
    [201, "asteroid"],
  ])("rank %i is %s", (rank, cls) => {
    expect(classOf(rank)).toBe(cls);
  });

  it("sizes shrink with rank and match the prototype anchors", () => {
    expect(sizeOf(1)).toBe(5.2);
    expect(sizeOf(2)).toBeCloseTo(3.9);
    expect(sizeOf(10)).toBeCloseTo(2.7);
    expect(sizeOf(11)).toBeCloseTo(2.3);
    expect(sizeOf(51)).toBeCloseTo(1.3);
    expect(sizeOf(200)).toBeCloseTo(0.5);
    expect(sizeOf(500)).toBeGreaterThanOrEqual(0.16);
    expect(sizeOf(500)).toBeLessThan(0.28);
  });
});

describe("orbitOf", () => {
  it("puts the oldest holder closest and the newest farthest", () => {
    const first = orbitOf("A", 1, 100).orbit;
    const last = orbitOf("A", 100, 100).orbit;
    expect(first).toBeGreaterThan(31);
    expect(first).toBeLessThan(37);
    expect(last).toBeGreaterThan(551);
    expect(last).toBeLessThan(557);
  });
});

describe("rng", () => {
  it("resumes the same sequence from a saved state", () => {
    const a = rngFor("wallet1sim");
    a();
    a();
    const saved = a.state;
    const expected = [a(), a(), a()];
    const b = mulberry32(saved);
    expect([b(), b(), b()]).toEqual(expected);
  });
});

describe("star tiers", () => {
  it("picks the tier by market cap", () => {
    expect(STAR_TIERS[starTierIndex(50_000)]!.cls).toBe("M");
    expect(STAR_TIERS[starTierIndex(1_840_000)]!.cls).toBe("G");
    expect(STAR_TIERS[starTierIndex(5e9)]!.cls).toBe("O");
  });
});

describe("esc", () => {
  it("escapes HTML", () => {
    expect(esc(`<img src=x onerror="a('b')">&`)).toBe(
      "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;",
    );
  });
});
