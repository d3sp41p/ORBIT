import pg from "pg";
import { TokenController } from "./controller";
import { loadConfig, type WorkerConfig } from "./env";
import { startHealthServer, type HealthState } from "./health";
import { Helius } from "./helius";
import { Planets } from "./planets";

const state: HealthState = { startedAt: new Date() };
let cfg: WorkerConfig;
try {
  cfg = loadConfig();
} catch (e) {
  // Missing settings must not crash-loop the host: stay up for health checks.
  const port = Number(process.env.PORT ?? 8080);
  state.indexer = `disabled: ${e instanceof Error ? e.message : e}`;
  startHealthServer(port, state);
  console.error(`[worker] indexer disabled: ${e instanceof Error ? e.message : e}`);
  setInterval(() => console.error("[worker] indexer disabled: configuration missing"), 10 * 60_000);
  await new Promise(() => {});
}
const server = startHealthServer(cfg!.port, state);
console.log(`[worker] started on :${cfg!.port}, snapshot every ${cfg!.snapshotSec}s`);

// Timeouts everywhere: a silently dropped connection must fail a query,
// never leave it waiting forever (that froze every loop once).
const db = new pg.Pool({
  connectionString: cfg!.dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 60_000,
  query_timeout: 120_000,
  statement_timeout: 120_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});
db.on("error", (e) => console.error("[worker] database connection error:", e.message));
const helius = new Helius(cfg!.heliusKey);
const token = new TokenController(db, helius, cfg!, state);
const planets = new Planets(db);
state.webhook =
  cfg!.webhookUrl && cfg!.webhookSecret
    ? "ready"
    : "not managed (WEBHOOK_URL or HELIUS_WEBHOOK_SECRET missing)";
state.heliusCredits = () => helius.credits;

let stopping = false;
const timers: NodeJS.Timeout[] = [];

/** Loops that are running right now, with their start time (for the watchdog). */
const running = new Map<string, number>();

/** Run `fn` every `sec` seconds, never overlapping itself, logging failures. */
function every(name: string, sec: number, fn: () => Promise<unknown>) {
  let busy = false;
  const run = async () => {
    if (busy || stopping) return;
    busy = true;
    running.set(name, Date.now());
    try {
      await fn();
    } catch (e) {
      console.error(`[worker] ${name} failed:`, e instanceof Error ? e.message : e);
    } finally {
      busy = false;
      running.delete(name);
    }
  };
  timers.push(setInterval(run, sec * 1000));
  return run();
}

// Token control (config, launch detection, webhook) runs often and may switch
// the indexer to a new coin; the other loops use whichever indexer is current.
void every("token", 3, () => token.tick());
void every("apply", 5, async () => token.indexer?.applyPending());
void every("snapshot", cfg!.snapshotSec, async () => token.indexer?.snapshot());
void every("price", 60, async () => token.indexer?.refreshPrice());
// Planet life: births and deaths follow the holders; due ticks are caught up in batches.
void every("lifecycle", 10, async () => token.indexer && (await planets.lifecycle()));
void every("ticks", 30, async () => {
  if (!token.indexer) return;
  while ((await planets.ticks()) === 100 && !stopping);
});
timers.push(
  setInterval(
    () => console.log(`[worker] alive, Helius credits used ~${helius.credits}`),
    10 * 60_000,
  ),
);

// Watchdog: a loop stuck far longer than it should be means something hangs. Exit and let
// the host restart the worker; ticks and events are caught up after a restart.
// The token loop may restore a long history and ticks may catch up a backlog.
const STUCK_MS: Record<string, number> = { token: 90 * 60_000, ticks: 30 * 60_000 };
const DEFAULT_STUCK_MS = 10 * 60_000;
timers.push(
  setInterval(() => {
    for (const [name, since] of running)
      if (Date.now() - since > (STUCK_MS[name] ?? DEFAULT_STUCK_MS)) {
        console.error(
          `[worker] loop "${name}" stuck for ${Math.round((Date.now() - since) / 60_000)} min: restarting`,
        );
        process.exit(1);
      }
  }, 30_000),
);

function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, shutting down`);
  stopping = true;
  timers.forEach(clearInterval);
  server.close(() => db.end().finally(() => process.exit(0)));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
