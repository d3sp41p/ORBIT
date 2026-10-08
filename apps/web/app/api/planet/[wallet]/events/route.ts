import { isWallet, loadEvents } from "@/lib/api";
import { apiError, cached, liveAllowed, select } from "@/lib/db";

/** Planet news, 20 per page, newest first. ?cursor=<id of the last item shown> */
export async function GET(req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!isWallet(wallet)) return apiError(400, "bad_wallet", "Not a wallet address");
  try {
    if (!(await liveAllowed(req))) return apiError(404, "not_found", "No such planet");
    const url = new URL(req.url);
    const { rows } = await select<{ life_no: number }>(
      `holders?wallet=eq.${wallet}&select=life_no`,
    );
    if (!rows[0]) return apiError(404, "not_found", "No planet for that address yet");
    const page = await loadEvents(
      wallet,
      rows[0].life_no,
      url.searchParams.get("cursor") ?? undefined,
    );
    const preview = url.searchParams.has("preview");
    return Response.json(page, {
      headers: preview ? { "cache-control": "private, no-store" } : cached(15),
    });
  } catch {
    return apiError(503, "unavailable", "News are not available right now");
  }
}
