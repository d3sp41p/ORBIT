import { createServer, type Server } from "node:http";

export interface HealthState {
  startedAt: Date;
  /** What the indexer is doing (no secrets: names of missing settings at most). */
  indexer?: string;
  /** Whether the worker can manage the Helius webhook. */
  webhook?: string;
  heliusCredits?: () => number;
  /** AI texts: on, paused or off, with today's spend. */
  ai?: () => string;
}

export function healthBody(state: HealthState, now = new Date()) {
  return {
    status: "ok",
    service: "orbit-worker",
    startedAt: state.startedAt.toISOString(),
    uptimeSeconds: Math.floor((now.getTime() - state.startedAt.getTime()) / 1000),
    indexer: state.indexer ?? "starting",
    webhook: state.webhook ?? "unknown",
    heliusCredits: state.heliusCredits?.() ?? 0,
    ai: state.ai?.() ?? "unknown",
  };
}

/** Minimal HTTP server so the host can probe the worker. */
export function startHealthServer(port: number, state: HealthState): Server {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(healthBody(state)));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
  });
  server.listen(port);
  return server;
}
