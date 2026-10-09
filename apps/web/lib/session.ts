/**
 * Sessions after wallet sign-in: a random token in an httpOnly cookie for 7
 * days; the database keeps only its SHA-256 (spec: "Sign-in flow").
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { parseAddressList, SESSION_TTL_MS } from "@orbit/core";
import { cookies } from "next/headers";
import { adminRest, adminRpc } from "./admin-db";

const COOKIE = "orbit_session";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Wallet of the signed-in visitor, or null. */
export async function sessionWallet(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const rows = await adminRest<{ wallet: string }[]>(
    `auth_sessions?token_hash=eq.${sha256(token)}&expires_at=gt.${new Date().toISOString()}&select=wallet`,
  );
  return rows[0]?.wallet ?? null;
}

export async function startSession(wallet: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await adminRest("auth_sessions", {
    method: "POST",
    body: { token_hash: sha256(token), wallet, expires_at: expires.toISOString() },
    prefer: "return=minimal",
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token)
    await adminRest(`auth_sessions?token_hash=eq.${sha256(token)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
  jar.delete(COOKIE);
}

export const isAdmin = (wallet: string | null) =>
  !!wallet && parseAddressList(process.env.ADMIN_WALLETS).has(wallet);

/** The host the visitor sees (the domain written into sign-in messages). */
export const siteHost = (req: Request) =>
  (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0]!.trim();

/**
 * Writes only from our own pages: the browser's Origin must match the host
 * (the SameSite cookie already blocks most cross-site requests).
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === siteHost(req);
  } catch {
    return false;
  }
}

/** Visitor key for limits and reports: a hash, the address itself is not stored. */
export function visitorKey(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "unknown";
  return sha256(`${ip}|${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`).slice(0, 32);
}

/** Count a request against a limit; false when it is used up. */
export const rateOk = (key: string, limit: number, windowSec: number) =>
  adminRpc<boolean>("rate_hit", { p_key: key, p_limit: limit, p_window_sec: windowSec });

/** JSON response that is never cached. */
export const fresh = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
