import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { feePayer, launchCandidates, matchesExpected, type RawLaunchTx } from "./launch";

const load = <T>(name: string): T =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8"),
  );

// A real pump.fun create transaction (create + dev buy) and a later trade.
const create = load<{ mint: string; symbol: string; name: string; tx: RawLaunchTx }>(
  "pumpfun-create.json",
);
const trade = load<RawLaunchTx>("pumpfun-trade.json");
const dev = feePayer(create.tx)!;

describe("launch detection", () => {
  it("finds the new mint in a pump.fun create signed by the dev wallet", () => {
    expect(launchCandidates(create.tx, dev)).toEqual([create.mint]);
  });

  it("ignores the same create when watching another wallet", () => {
    expect(launchCandidates(create.tx, "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T")).toEqual([]);
  });

  it("ignores ordinary trades, even of the dev wallet's own token", () => {
    expect(launchCandidates(trade, feePayer(trade)!)).toEqual([]);
  });

  it("ignores failed transactions", () => {
    const failed = {
      ...create.tx,
      meta: { ...create.tx.meta, err: { InstructionError: [0, {}] } },
    };
    expect(launchCandidates(failed, dev)).toEqual([]);
  });
});

describe("expected token check", () => {
  it("matches ticker and name ignoring case and $", () => {
    expect(
      matchesExpected({ symbol: "ORBIT", name: "ORBIT" }, { ticker: "$orbit", name: "orbit" }),
    ).toBe(true);
    expect(matchesExpected({ symbol: "ORBIT", name: "Orbit Coin" }, { ticker: "ORBIT" })).toBe(
      true,
    );
  });

  it("rejects a different token from the same wallet", () => {
    expect(
      matchesExpected({ symbol: "TEST", name: "ORBIT" }, { ticker: "ORBIT", name: "ORBIT" }),
    ).toBe(false);
    expect(
      matchesExpected({ symbol: "ORBIT", name: "Other" }, { ticker: "ORBIT", name: "ORBIT" }),
    ).toBe(false);
  });

  it("never matches when nothing is expected", () => {
    expect(matchesExpected({ symbol: "ORBIT", name: "ORBIT" }, {})).toBe(false);
  });

  it("matches the recorded token by its own metadata", () => {
    expect(matchesExpected(create, { ticker: create.symbol, name: create.name })).toBe(true);
  });
});
