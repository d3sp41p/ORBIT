import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as shaders from "./shaders";

const PROTOTYPE = fileURLToPath(
  new URL("../../../reference/ORBIT_prototype.html", import.meta.url),
);

describe("shaders", () => {
  it("match the prototype character for character", () => {
    const html = readFileSync(PROTOTYPE, "utf8");
    const src = html.slice(html.indexOf("const NOISE=`"), html.indexOf("const skyRes="));
    const names = Object.keys(shaders).filter((k) => !k.startsWith("NEAR_STARS"));
    const proto = new Function(`${src}\nreturn { ${names.join(", ")} };`)() as Record<
      string,
      string
    >;
    for (const name of names) {
      expect(shaders[name as keyof typeof shaders], name).toBe(proto[name]);
    }
    expect(html).toContain(shaders.NEAR_STARS_VS);
    expect(html).toContain(shaders.NEAR_STARS_FS);
  });
});
