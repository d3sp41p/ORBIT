import { isWallet } from "@/lib/api";
import { adminRest } from "@/lib/admin-db";
import { apiError } from "@/lib/db";
import { fresh, isAdmin, sameOrigin, sessionWallet } from "@/lib/session";

/**
 * Hide (or show again) a planet's custom names; stock names are shown while
 * hidden. Closes the planet's open reports either way. Body: {hidden}.
 */
export async function POST(req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!sameOrigin(req)) return apiError(403, "bad_origin", "Requests only from the site");
  if (!isWallet(wallet)) return apiError(400, "bad_wallet", "Not a wallet address");
  const { hidden } = (await req.json().catch(() => ({}))) as { hidden?: unknown };
  try {
    if (!isAdmin(await sessionWallet())) return apiError(403, "not_admin", "Admins only");
    await adminRest(`planet_custom?wallet=eq.${wallet}`, {
      method: "PATCH",
      body: { hidden_by_admin: hidden !== false },
      prefer: "return=minimal",
    });
    await adminRest(`name_reports?wallet=eq.${wallet}&resolved_at=is.null`, {
      method: "PATCH",
      body: { resolved_at: new Date().toISOString() },
      prefer: "return=minimal",
    });
    return fresh({ wallet, hidden: hidden !== false });
  } catch {
    return apiError(503, "unavailable", "Try again in a moment");
  }
}
