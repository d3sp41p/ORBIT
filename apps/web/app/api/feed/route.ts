import { loadFeed } from "@/lib/api";
import { apiError, cached, liveAllowed } from "@/lib/db";

/** Global feed of notable events, newest first. ?cursor=<ms>_<id> */
export async function GET(req: Request) {
  try {
    if (!(await liveAllowed(req))) return Response.json({ items: [], next: null });
    const url = new URL(req.url);
    const page = await loadFeed(url.searchParams.get("cursor") ?? undefined);
    const preview = url.searchParams.has("preview");
    return Response.json(page, {
      headers: preview ? { "cache-control": "private, no-store" } : cached(15),
    });
  } catch {
    return apiError(503, "unavailable", "The feed is not available right now");
  }
}
