import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCyrillic } from "./check-cyrillic.mjs";

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-cyr-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

describe("findCyrillic", () => {
  it("passes on English-only files", () => {
    const dir = fixture({ "apps/a.ts": "const x = 'Hello';\n" });
    expect(findCyrillic(["apps"], dir)).toEqual([]);
  });

  it("reports file and line of Cyrillic text", () => {
    // "Привет" spells a Russian greeting; kept escaped so this file stays clean.
    const dir = fixture({ "packages/b.ts": "ok\nconst s = 'Привет';\n" });
    const hits = findCyrillic(["packages"], dir);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });

  it("ignores node_modules", () => {
    const dir = fixture({ "apps/node_modules/x/i.js": "'ё'" });
    expect(findCyrillic(["apps"], dir)).toEqual([]);
  });
});
