import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { readSignIn, signInMessage, verifySignature } from "./auth";
import { base58Decode, base58Encode } from "./chain";

const secret = ed25519.utils.randomSecretKey();
const wallet = base58Encode(ed25519.getPublicKey(secret));
const msg = signInMessage({
  domain: "orbit.mba",
  wallet,
  nonce: "abc123",
  issuedAt: new Date("2026-10-09T10:00:00Z"),
  expiresAt: new Date("2026-10-09T10:05:00Z"),
});
const sign = (m: string, key = secret) => ed25519.sign(new TextEncoder().encode(m), key);

describe("wallet sign-in", () => {
  it("round-trips base58 addresses", () => {
    expect(base58Encode(base58Decode(wallet))).toBe(wallet);
  });

  it("writes a readable message with no transaction in it", () => {
    expect(msg).toContain("orbit.mba wants you to sign in with your Solana account:");
    expect(msg).toContain("This is not a transaction");
    expect(readSignIn(msg)).toEqual({
      domain: "orbit.mba",
      wallet,
      expiresAt: new Date("2026-10-09T10:05:00Z"),
    });
    expect(readSignIn("hello")).toBeNull();
  });

  it("accepts only the wallet's own signature of this exact message", () => {
    expect(verifySignature(wallet, msg, sign(msg))).toBe(true);
    expect(verifySignature(wallet, msg + " ", sign(msg))).toBe(false);
    expect(verifySignature(wallet, msg, sign(msg, ed25519.utils.randomSecretKey()))).toBe(false);
    expect(verifySignature(wallet, msg, new Uint8Array(64))).toBe(false);
    expect(verifySignature("not-base58!", msg, sign(msg))).toBe(false);
  });
});
