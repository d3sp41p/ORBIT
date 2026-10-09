/**
 * Read-only access to public tables through Supabase REST with the anon key
 * (row level security allows select only). Server code only.
 */

export class DbError extends Error {}

const conf = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new DbError("database not configured");
  return { url, key };
};

/** One request. `revalidate` seconds of Next data cache (0 = none). */
export async function select<T>(
  path: string,
  opts: { revalidate?: number; count?: boolean; range?: [number, number] } = {},
): Promise<{ rows: T[]; total: number | null }> {
  const { url, key } = conf();
  const headers: Record<string, string> = { apikey: key };
  if (opts.count) headers.prefer = "count=exact";
  if (opts.range) headers.range = `${opts.range[0]}-${opts.range[1]}`;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers,
    ...(opts.revalidate
      ? { next: { revalidate: opts.revalidate } }
      : { cache: "no-store" as const }),
  });
  if (!res.ok) throw new DbError(`${res.status} ${await res.text()}`);
  const total = Number(res.headers.get("content-range")?.split("/")[1]);
  return { rows: (await res.json()) as T[], total: Number.isFinite(total) ? total : null };
}

/** Call a database function open to the anon role (no cache). */
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { url, key } = conf();
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new DbError(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** All rows of a query, page by page (the API returns at most 1,000 at a time). */
export async function selectAll<T>(path: string, revalidate?: number): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { rows } = await select<T>(path, { revalidate, range: [from, from + 999] });
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/** JSON error in the spec's format. */
export const apiError = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

/** Public cache headers: CDN keeps it for `sec`, then serves stale while refreshing. */
export const cached = (sec: number) => ({
  "cache-control": `public, s-maxage=${sec}, stale-while-revalidate=${sec * 2}`,
});

/**
 * Real data is public only after launch. Before that it can be previewed with
 * ?preview=<PREVIEW_KEY> (testing on a stand-in or test coin).
 */
export async function liveAllowed(req: Request): Promise<boolean> {
  const key = process.env.PREVIEW_KEY;
  const preview = new URL(req.url).searchParams.get("preview");
  if (key && preview && preview === key) return true;
  return launched();
}

/** Whether the coin is live (real data is public). */
export async function launched(): Promise<boolean> {
  const { rows } = await select<{ launched: boolean }>("system_state?id=eq.1&select=launched", {
    revalidate: 5,
  });
  return !!rows[0]?.launched;
}
