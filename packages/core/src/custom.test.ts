import { describe, expect, it } from "vitest";
import { applyNames, namePairs } from "./custom";
import { generateDemoSystem } from "./demo";
import { checkCustom, isOffensive } from "./moderation";
import { mulberry32 } from "./rng";
import { nameGen } from "./names";
import { W } from "./words";

describe("custom names in texts", () => {
  const stock = {
    name: "Solbro 8GI",
    species: "Korrelids",
    capital: "Rigasar",
    motto: "Slowly, but to orbit",
  };
  const pairs = namePairs(stock, {
    name: "New Eden",
    species: "Zorgons",
    capital: "Hub",
    motto: null,
  });

  it("replaces whole names, plural and singular species", () => {
    expect(
      applyNames(
        "Solbro 8GI: the Korrelids founded Rigasar. Korrelid engineers cheer. Rigasarians and Solbro 8GIX stay.",
        pairs,
      ),
    ).toBe(
      "New Eden: the Zorgons founded Hub. Zorgon engineers cheer. Rigasarians and Solbro 8GIX stay.",
    );
  });

  it("does not chain replacements and keeps stock values that were not changed", () => {
    const p = namePairs(stock, {
      name: "Rigasar",
      species: null,
      capital: "Solbro 8GI",
      motto: null,
    });
    expect(applyNames("Solbro 8GI and Rigasar", p)).toBe("Rigasar and Solbro 8GI");
    expect(applyNames("Slowly, but to orbit", pairs)).toBe("Slowly, but to orbit");
    expect(namePairs(stock, null)).toEqual([]);
  });
});

describe("customisation check", () => {
  it("accepts normal names and turns empty fields into stock values", () => {
    const r = checkCustom({
      name: "  New   Eden ",
      species: "Zorgons",
      capital: "",
      motto: "Hold, always!",
    });
    expect(r).toEqual({
      ok: true,
      values: { name: "New Eden", species: "Zorgons", capital: null, motto: "Hold, always!" },
    });
    for (const name of [
      "Kepler's Rest",
      "Neo-Tokyo 2",
      "Glasgow",
      "Scunthorpe",
      "Essex",
      "Hancock",
      "Therapist",
      "Con Air",
      "Analu",
    ])
      expect(checkCustom({ name }), name).toMatchObject({ ok: true });
  });

  it("rejects length, characters, links, emoji, other scripts", () => {
    expect(checkCustom({ name: "x".repeat(25) })).toMatchObject({ ok: false, code: "too_long" });
    expect(checkCustom({ motto: "y".repeat(61) })).toMatchObject({ ok: false, code: "too_long" });
    expect(checkCustom({ name: "Nova 🚀" })).toMatchObject({ ok: false, code: "bad_chars" });
    // A Cyrillic word, built from char codes: the repository allows no Cyrillic in code.
    const cyrillic = String.fromCharCode(0x41d, 0x43e, 0x432, 0x430, 0x44f);
    expect(checkCustom({ name: cyrillic })).toMatchObject({
      ok: false,
      code: "bad_chars",
    });
    expect(checkCustom({ name: "<b>x</b>" })).toMatchObject({ ok: false, code: "bad_chars" });
    expect(checkCustom({ motto: "Join us at orbit.xyz now" })).toMatchObject({
      ok: false,
      code: "link",
    });
    expect(checkCustom({ name: "123" })).toMatchObject({ ok: false, code: "no_letters" });
    expect(checkCustom({ name: 5 })).toMatchObject({ ok: false, code: "bad_type" });
  });

  it("catches profanity with digits, spaces and repeats, in several languages", () => {
    for (const s of [
      "f u c k",
      "F.U.C.K",
      "sh1t",
      "fuuuuck",
      "shit head",
      "n1gger",
      "1488",
      "blyat",
      "b l y a t",
      "pidor",
      "puta",
      "kurwa",
      "scheisse",
      "merde",
      "cazzo",
      "admin",
    ])
      expect(isOffensive(s), s).toBe(true);
  });

  it("almost never hits the game's own names and words", () => {
    const r = mulberry32(7);
    let hits = 0;
    for (let i = 0; i < 3000; i++)
      if (isOffensive(nameGen(r)) || isOffensive(nameGen(r, 2, 2) + "ids")) hits++;
    expect(hits).toBeLessThanOrEqual(3);
    for (const m of W.motto) expect(isOffensive(m), m).toBe(false);
    const names = generateDemoSystem(Date.UTC(2026, 9, 9)).holders.map((h) => h.name);
    expect(names.filter(isOffensive).length).toBeLessThanOrEqual(2);
  });
});
