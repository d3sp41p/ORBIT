/**
 * Status for monitoring (spec: "GET /api/health"): last webhook, last
 * reconciliation, tick lag, AI queue and spend, unapplied chain events and,
 * when WORKER_HEALTH_URL is set, the worker's own report.
 * Answers 503 when something needs attention, so an uptime monitor alerts:
 * after launch, ticks more than 30 minutes late, a snapshot older than 15
 * minutes, a backlog of chain events, or a silent worker.
 */
export const dynamic = "force-dynamic";

const MIN = 60_000;

async function rest(path: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const headers: Record<string, string> = { apikey: key, prefer: "count=exact" };
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;
  const res = await fetch(`${url}/rest/v1/${path}`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res;
}

const total = (res: Response | null) => {
  const n = Number(res?.headers.get("content-range")?.split("/")[1] ?? NaN);
  return Number.isFinite(n) ? n : null;
};

async function worker() {
  const url = process.env.WORKER_HEALTH_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { reachable: false };
    const j = (await res.json()) as Record<string, unknown>;
    return {
      reachable: true,
      indexer: j.indexer,
      webhook: j.webhook,
      ai: j.ai,
      uptimeSeconds: j.uptimeSeconds,
    };
  } catch {
    return { reachable: false };
  }
}

export async function GET() {
  const now = Date.now();
  const base = { service: "orbit-web", time: new Date(now).toISOString() };
  try {
    const today = new Date(now).toISOString().slice(0, 10);
    const [stateRes, pendingRes, tickRes, queueRes, usageRes, w] = await Promise.all([
      rest("system_state?id=eq.1&select=launched,last_webhook_at,last_snapshot_at,holders_count"),
      rest("chain_events?applied=eq.false&select=sig&limit=1"),
      rest("planet_state?select=next_tick_at&order=next_tick_at.asc&limit=1"),
      rest("ai_jobs?attempts=lt.3&select=id&limit=1"),
      rest(`ai_usage?date=eq.${today}&select=requests,cost_usd`),
      worker(),
    ]);
    if (!stateRes) return Response.json({ ...base, status: "ok", db: "not_configured" });
    const [s] = (await stateRes.json()) as {
      launched: boolean;
      last_webhook_at: string | null;
      last_snapshot_at: string | null;
      holders_count: number;
    }[];
    const [oldest] = ((await tickRes?.json()) ?? []) as { next_tick_at: string }[];
    const [usage] = ((await usageRes?.json()) ?? []) as { requests: number; cost_usd: string }[];
    const tickLagSeconds = oldest
      ? Math.max(0, Math.round((now - new Date(oldest.next_tick_at).getTime()) / 1000))
      : 0;
    const pending = total(pendingRes);
    const snapshotAge = s?.last_snapshot_at ? now - new Date(s.last_snapshot_at).getTime() : null;

    // Before launch nothing is indexed, so only the database and the worker count.
    const problems: string[] = [];
    if (s?.launched) {
      if (tickLagSeconds > 30 * 60) problems.push("ticks are more than 30 minutes late");
      if (snapshotAge === null || snapshotAge > 15 * MIN)
        problems.push("no reconciliation for 15 minutes");
      if ((pending ?? 0) > 1000) problems.push("chain events are piling up");
    }
    if (w && !w.reachable) problems.push("worker does not answer");

    return Response.json(
      {
        ...base,
        status: problems.length ? "degraded" : "ok",
        problems,
        db: "ok",
        launched: !!s?.launched,
        worlds: s?.holders_count ?? 0,
        lastWebhookAt: s?.last_webhook_at ?? null,
        lastSnapshotAt: s?.last_snapshot_at ?? null,
        tickLagSeconds,
        pendingChainEvents: pending,
        aiQueue: total(queueRes),
        aiToday: { requests: usage?.requests ?? 0, costUsd: Number(usage?.cost_usd ?? 0) },
        worker: w,
      },
      { status: problems.length ? 503 : 200, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ...base, status: "degraded", problems: ["database error"], db: "error" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
