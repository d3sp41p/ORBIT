import { isOnCurve, NONCE_TTL_MS, signInMessage } from "@orbit/core";
import { randomBytes } from "node:crypto";
import { isWallet } from "@/lib/api";
import { adminRest } from "@/lib/admin-db";
import { apiError } from "@/lib/db";
import { fresh, rateOk, sameOrigin, siteHost, visitorKey } from "@/lib/session";

/** One-time message for the wallet to sign (valid 5 minutes). Body: {wallet}. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "bad_origin", "Requests only from the site");
  const { wallet } = (await req.json().catch(() => ({}))) as { wallet?: unknown };
  if (typeof wallet !== "string" || !isWallet(wallet) || !isOnCurve(wallet))
    return apiError(400, "bad_wallet", "Not a wallet address");
  try {
    if (!(await rateOk(`auth:${visitorKey(req)}`, 10, 60)))
      return apiError(429, "rate_limited", "Too many attempts, try again in a minute");
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);
    const message = signInMessage({ domain: siteHost(req), wallet, nonce, issuedAt, expiresAt });
    await adminRest("auth_nonces", {
      method: "POST",
      body: { nonce, wallet, expires_at: expiresAt.toISOString(), message },
      prefer: "return=minimal",
    });
    return fresh({ nonce, message });
  } catch {
    return apiError(503, "unavailable", "Sign-in is not available right now");
  }
}
