import { CUSTOM_FIELDS, type CustomField } from "@orbit/core";
import { checkCustom } from "@orbit/core/moderation";
import { isWallet } from "@/lib/api";
import { adminRest } from "@/lib/admin-db";
import { apiError } from "@/lib/db";
import { fresh, sameOrigin, sessionWallet } from "@/lib/session";

type Params = { params: Promise<{ wallet: string }> };

const DAY_MS = 86_400_000;

/** The signed-in owner of this living planet, or an error response. */
async function owner(req: Request, wallet: string): Promise<Response | null> {
  if (!sameOrigin(req)) return apiError(403, "bad_origin", "Requests only from the site");
  if (!isWallet(wallet)) return apiError(400, "bad_wallet", "Not a wallet address");
  const me = await sessionWallet();
  if (!me) return apiError(401, "not_signed_in", "Connect your wallet first");
  if (me !== wallet) return apiError(403, "not_owner", "Only the owner can change this planet");
  const [h] = await adminRest<{ status: string; life_no: number }[]>(
    `holders?wallet=eq.${wallet}&select=status,life_no`,
  );
  const [ps] = await adminRest<{ life_no: number }[]>(
    `planet_state?wallet=eq.${wallet}&select=life_no`,
  );
  if (h?.status !== "alive" || !ps || ps.life_no !== h.life_no)
    return apiError(409, "no_planet", "This wallet has no living planet");
  return null;
}

/**
 * Save the name, species, capital and motto (empty = stock value). Checked on
 * the server; at most one change a day. New names are visible again even if
 * the admin hid the previous ones.
 */
export async function PUT(req: Request, { params }: Params) {
  const { wallet } = await params;
  try {
    const denied = await owner(req, wallet);
    if (denied) return denied;
    const body = (await req.json().catch(() => null)) as Partial<
      Record<CustomField, unknown>
    > | null;
    if (!body || typeof body !== "object")
      return apiError(400, "bad_request", "JSON body expected");
    const r = checkCustom(body);
    if (!r.ok)
      return Response.json(
        { error: { code: r.code, message: r.message, field: r.field } },
        { status: 422 },
      );
    const [prev] = await adminRest<{ updated_at: string }[]>(
      `planet_custom?wallet=eq.${wallet}&select=updated_at`,
    );
    const last = prev ? new Date(prev.updated_at).getTime() : 0;
    if (Date.now() - last < DAY_MS)
      return Response.json(
        {
          error: {
            code: "too_soon",
            message: "You can change your planet once a day",
            retryAt: last + DAY_MS,
          },
        },
        { status: 429 },
      );
    await adminRest("planet_custom", {
      method: "POST",
      body: {
        wallet,
        ...r.values,
        updated_at: new Date().toISOString(),
        hidden_by_admin: false,
      },
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    return fresh({ custom: r.values });
  } catch {
    return apiError(503, "unavailable", "Saving is not available right now");
  }
}

/** Restore the stock values (does not count as the daily change). */
export async function DELETE(req: Request, { params }: Params) {
  const { wallet } = await params;
  try {
    const denied = await owner(req, wallet);
    if (denied) return denied;
    await adminRest(`planet_custom?wallet=eq.${wallet}`, {
      method: "PATCH",
      body: {
        ...Object.fromEntries(CUSTOM_FIELDS.map((f) => [f, null])),
        hidden_by_admin: false,
      },
      prefer: "return=minimal",
    });
    return fresh({ custom: null });
  } catch {
    return apiError(503, "unavailable", "Saving is not available right now");
  }
}
