import { describe, expect, it } from "vitest";
import { FpsGovernor, guessQuality } from "./quality";

describe("guessQuality", () => {
  it("uses low on ordinary phones and high on capable desktops", () => {
    expect(guessQuality({ width: 390, coarsePointer: true, cores: 6, memoryGb: 4 })).toBe("low");
    expect(guessQuality({ width: 1440, coarsePointer: false, cores: 12, memoryGb: 16 })).toBe(
      "high",
    );
    expect(guessQuality({ width: 1366, coarsePointer: false, cores: 4 })).toBe("medium");
  });
});

describe("FpsGovernor", () => {
  it("steps down when fps stays below target and not when it is fine", () => {
    let downs = 0;
    const slow = new FpsGovernor(() => (++downs, true), 40, 3, 0);
    for (let i = 0; i < 100; i++) slow.tick(1 / 25);
    expect(downs).toBe(1);

    let fine = 0;
    const fast = new FpsGovernor(() => (++fine, true), 40, 3, 0);
    for (let i = 0; i < 400; i++) fast.tick(1 / 60);
    expect(fine).toBe(0);
  });
});

describe("FpsGovernor throttling", () => {
  it("ignores throttled frames from a hidden or occluded window", () => {
    let downs = 0;
    const g = new FpsGovernor(() => (++downs, true), 40, 3, 0);
    for (let i = 0; i < 20; i++) g.tick(1);
    expect(downs).toBe(0);
  });
});
