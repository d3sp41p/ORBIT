import { hasCustom, type CustomValues } from "@orbit/core";
import { isWallet } from "@/lib/api";
import { adminRest } from "@/lib/admin-db";
import { apiError } from "@/lib/db";
import { fresh, rateOk, sameOrigin, visitorKey } from "@/lib/session";

/** "Report name": a complaint about a planet's custom names (5 an hour per visitor). */
export async function POST(req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!sameOrigin(req)) return apiError(403, "bad_origin", "Requests only from the site");
  if (!isWallet(wallet)) return apiError(400, "bad_wallet", "Not a wallet address");
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : null;
  try {
    const visitor = visitorKey(req);
    if (!(await rateOk(`report:${visitor}`, 5, 3600)))
      return apiError(429, "rate_limited", "Too many reports, try again later");
    const [c] = await adminRest<(CustomValues & { hidden_by_admin: boolean })[]>(
      `planet_custom?wallet=eq.${wallet}&select=name,species,capital,motto,hidden_by_admin`,
    );
    if (!c || c.hidden_by_admin || !hasCustom(c))
      return apiError(409, "no_custom_names", "This planet uses its stock names");
    // One open report per visitor and planet.
    const open = await adminRest<{ id: number }[]>(
      `name_reports?wallet=eq.${wallet}&ip_hash=eq.${visitor}&resolved_at=is.null&select=id`,
    );
    if (!open.length)
      await adminRest("name_reports", {
        method: "POST",
        body: { wallet, reason: reason || null, ip_hash: visitor },
        prefer: "return=minimal",
      });
    return fresh({ reported: true });
  } catch {
    return apiError(503, "unavailable", "Reports are not available right now");
  }
}
