import { describe, expect, it } from "vitest";
import { pickBody, type ScreenBody } from "./pick";

const body = (item: string, o: Partial<ScreenBody<string>>): ScreenBody<string> => ({
  item,
  x: 0,
  y: 0,
  z: 0.5,
  disk: 1,
  touch: 6,
  camDist: 100,
  ...o,
});

describe("pickBody", () => {
  it("keeps a close planet under the cursor even if a far asteroid is nearer on screen", () => {
    const planet = body("planet", { x: 400, y: 400, disk: 300, touch: 360, camDist: 10 });
    const asteroid = body("asteroid", { x: 502, y: 401, disk: 0.5, touch: 6, camDist: 900 });
    expect(pickBody(500, 400, [asteroid, planet])).toBe("planet");
  });

  it("picks a small body in empty space by its touch radius", () => {
    const asteroid = body("asteroid", { x: 100, y: 100, disk: 0.5, touch: 6 });
    expect(pickBody(104, 100, [asteroid])).toBe("asteroid");
    expect(pickBody(120, 100, [asteroid])).toBeNull();
  });

  it("prefers the body in front when two disks overlap", () => {
    const back = body("back", { x: 0, y: 0, disk: 50, camDist: 200 });
    const frontOne = body("front", { x: 10, y: 0, disk: 20, camDist: 50 });
    expect(pickBody(5, 0, [back, frontOne])).toBe("front");
  });

  it("ignores bodies behind the camera", () => {
    expect(pickBody(0, 0, [body("behind", { z: 1.2, disk: 50 })])).toBeNull();
  });
});
