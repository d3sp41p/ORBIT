import { loadSystem } from "@/lib/api";
import { apiError, cached, liveAllowed } from "@/lib/db";

/** Star, header numbers and the compact planet list for the 3D scene. */
export async function GET(req: Request) {
  try {
    if (!(await liveAllowed(req))) return Response.json({ live: false }, { headers: cached(5) });
    const preview = new URL(req.url).searchParams.has("preview");
    // Short caches: a new holder should see their planet within seconds.
    const data = await loadSystem(preview ? 0 : 4);
    return Response.json(
      { live: true, ...data },
      { headers: preview ? { "cache-control": "private, no-store" } : cached(5) },
    );
  } catch {
    return apiError(503, "unavailable", "System data is not available right now");
  }
}
