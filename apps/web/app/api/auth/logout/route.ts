import { apiError } from "@/lib/db";
import { endSession, fresh, sameOrigin } from "@/lib/session";

/** End the session. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "bad_origin", "Requests only from the site");
  try {
    await endSession();
    return fresh({ wallet: null });
  } catch {
    return apiError(503, "unavailable", "Try again in a moment");
  }
}
