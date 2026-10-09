/**
 * Writes for wallet sign-in, customisation and moderation. Uses the service
 * role key, so this module is server only: importing it from browser code
 * fails the build. Everything else on the site reads with the anon key.
 */
import "server-only";

export class AdminDbError extends Error {}

const conf = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new AdminDbError("SUPABASE_SERVICE_ROLE_KEY is not set");
  return { url, key };
};

/** One PostgREST request as the service role. */
export async function adminRest<T>(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<T> {
  const { url, key } = conf();
  const headers: Record<string, string> = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
  if (init.prefer) headers.prefer = init.prefer;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (!res.ok) throw new AdminDbError(`${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const adminRpc = <T>(fn: string, args: Record<string, unknown>) =>
  adminRest<T>(`rpc/${fn}`, { method: "POST", body: args });
