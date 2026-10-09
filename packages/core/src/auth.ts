/**
 * Wallet sign-in (spec: "Sign-in flow"): the one-time message a wallet signs
 * and the ed25519 check of the signature. No transaction is ever involved.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58Decode } from "./chain";

/** How long a sign-in message stays valid. */
export const NONCE_TTL_MS = 5 * 60_000;
/** Session length (httpOnly cookie). */
export const SESSION_TTL_MS = 7 * 86_400_000;

export interface SignIn {
  domain: string;
  wallet: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** Sign-In With Solana style text: wallets show the domain and the statement. */
export function signInMessage(s: SignIn): string {
  return [
    `${s.domain} wants you to sign in with your Solana account:`,
    s.wallet,
    "",
    "Sign in to ORBIT to customize your planet. This is not a transaction: it costs nothing and moves no tokens.",
    "",
    `URI: https://${s.domain}`,
    "Version: 1",
    `Nonce: ${s.nonce}`,
    `Issued At: ${s.issuedAt.toISOString()}`,
    `Expiration Time: ${s.expiresAt.toISOString()}`,
  ].join("\n");
}

/** Domain, wallet and expiry written in a message (null when it is not ours). */
export function readSignIn(
  message: string,
): { domain: string; wallet: string; expiresAt: Date } | null {
  const lines = message.split("\n");
  const domain = lines[0]?.match(/^(\S+) wants you to sign in with your Solana account:$/)?.[1];
  const wallet = lines[1];
  const exp = message.match(/^Expiration Time: (.+)$/m)?.[1];
  if (!domain || !wallet || !exp) return null;
  const expiresAt = new Date(exp);
  return Number.isNaN(expiresAt.getTime()) ? null : { domain, wallet, expiresAt };
}

/** True when `signature` (64 bytes) is the wallet's ed25519 signature of `message`. */
export function verifySignature(wallet: string, message: string, signature: Uint8Array): boolean {
  try {
    const key = base58Decode(wallet);
    if (key.length !== 32 || signature.length !== 64) return false;
    return ed25519.verify(signature, new TextEncoder().encode(message), key);
  } catch {
    return false;
  }
}
