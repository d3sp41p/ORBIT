import { isWallet, loadPlanet } from "@/lib/api";
import { apiError, cached, liveAllowed } from "@/lib/db";

/** Full mission page of one planet. */
export async function GET(req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!isWallet(wallet)) return apiError(400, "bad_wallet", "Not a wallet address");
  try {
    if (!(await liveAllowed(req))) return apiError(404, "not_found", "No such planet");
    const r = await loadPlanet(wallet);
    if (r.status === "none") return apiError(404, "not_found", "No planet for that address yet");
    const preview = new URL(req.url).searchParams.has("preview");
    return Response.json(r, {
      headers: preview ? { "cache-control": "private, no-store" } : cached(15),
    });
  } catch {
    return apiError(503, "unavailable", "Planet data is not available right now");
  }
}
