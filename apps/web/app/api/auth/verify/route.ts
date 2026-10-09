import { readSignIn, verifySignature } from "@orbit/core";
import { isWallet } from "@/lib/api";
import { adminRpc } from "@/lib/admin-db";
import { apiError } from "@/lib/db";
import {
  fresh,
  isAdmin,
  rateOk,
  sameOrigin,
  siteHost,
  startSession,
  visitorKey,
} from "@/lib/session";

/**
 * Check the signed message and start a session. Body: {wallet, nonce,
 * signature} with the signature in base64. The nonce works once.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "bad_origin", "Requests only from the site");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { wallet, nonce, signature } = body;
  if (typeof wallet !== "string" || !isWallet(wallet))
    return apiError(400, "bad_wallet", "Not a wallet address");
  if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce) || typeof signature !== "string")
    return apiError(400, "bad_request", "Nonce and signature are required");
  try {
    if (!(await rateOk(`auth:${visitorKey(req)}`, 10, 60)))
      return apiError(429, "rate_limited", "Too many attempts, try again in a minute");
    const message = await adminRpc<string | null>("consume_nonce", {
      p_nonce: nonce,
      p_wallet: wallet,
    });
    const info = message ? readSignIn(message) : null;
    if (!message || !info) return apiError(401, "bad_nonce", "Sign-in expired, please try again");
    if (info.domain !== siteHost(req) || info.wallet !== wallet || info.expiresAt < new Date())
      return apiError(401, "bad_message", "Sign-in message does not match, please try again");
    const sig = Buffer.from(signature, "base64");
    if (!verifySignature(wallet, message, new Uint8Array(sig)))
      return apiError(401, "bad_signature", "The signature does not match this wallet");
    await startSession(wallet);
    return fresh({ wallet, admin: isAdmin(wallet) });
  } catch {
    return apiError(503, "unavailable", "Sign-in is not available right now");
  }
}
