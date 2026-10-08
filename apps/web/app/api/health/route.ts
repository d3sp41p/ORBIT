/**
 * Status for monitoring: last webhook, last reconciliation snapshot, number
 * of worlds and unapplied chain events. Tick lag and the AI queue join in
 * stages 5-6.
 */
export const dynamic = "force-dynamic";

async function rest(path: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const headers: Record<string, string> = { apikey: key };
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { ...headers, prefer: "count=exact" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res;
}

export async function GET() {
  const base = { status: "ok", service: "orbit-web", time: new Date().toISOString() };
  try {
    const [stateRes, pendingRes] = await Promise.all([
      rest("system_state?id=eq.1&select=last_webhook_at,last_snapshot_at,holders_count,updated_at"),
      rest("chain_events?applied=eq.false&select=sig&limit=1"),
    ]);
    if (!stateRes) return Response.json({ ...base, db: "not_configured" });
    const [s] = (await stateRes.json()) as Record<string, unknown>[];
    const pending = Number(pendingRes?.headers.get("content-range")?.split("/")[1] ?? NaN);
    return Response.json({
      ...base,
      db: "ok",
      lastWebhookAt: s?.last_webhook_at ?? null,
      lastSnapshotAt: s?.last_snapshot_at ?? null,
      worlds: s?.holders_count ?? 0,
      pendingChainEvents: Number.isFinite(pending) ? pending : null,
    });
  } catch {
    return Response.json({ ...base, status: "degraded", db: "error" }, { status: 503 });
  }
}
