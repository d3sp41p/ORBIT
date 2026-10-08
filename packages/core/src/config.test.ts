import { describe, expect, it } from "vitest";
import { BALANCE } from "./config";

describe("BALANCE", () => {
  it("matches the spec values", () => {
    expect(BALANCE).toEqual({
      tickHours: 4,
      eventChance: 0.33,
      asteroidEventFactor: 0.35,
      rareChance: 1 / 6000,
      speed: 1.0,
      sizeBonusMax: 2.0,
      sellPenalty: 1.0,
      sellIgnoreBelow: 0.02,
      ringsAfterDays: 30,
    });
  });
});
