import { searchPlanets } from "@/lib/api";
import { apiError, cached, liveAllowed } from "@/lib/db";

/** Search by full or partial address and planet name, up to 10 results. ?q= */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 64);
  try {
    if (!(await liveAllowed(req))) return Response.json({ results: [] });
    const results = await searchPlanets(q);
    const preview = url.searchParams.has("preview");
    return Response.json(
      { results },
      { headers: preview ? { "cache-control": "private, no-store" } : cached(30) },
    );
  } catch {
    return apiError(503, "unavailable", "Search is not available right now");
  }
}
