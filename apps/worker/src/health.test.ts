import { describe, expect, it } from "vitest";
import { healthBody } from "./health";

describe("healthBody", () => {
  it("reports uptime in whole seconds", () => {
    const startedAt = new Date("2026-10-08T00:00:00Z");
    const body = healthBody({ startedAt }, new Date("2026-10-08T00:01:30.900Z"));
    expect(body).toMatchObject({ status: "ok", uptimeSeconds: 90 });
  });
});
