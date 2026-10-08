import pg from "pg";
import { TokenController } from "./controller";
import { loadConfig, type WorkerConfig } from "./env";
import { startHealthServer, type HealthState } from "./health";
import { Helius } from "./helius";

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

const db = new pg.Pool({
  connectionString: cfg!.dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 5,
});
const helius = new Helius(cfg!.heliusKey);
const token = new TokenController(db, helius, cfg!, state);
state.webhook =
  cfg!.webhookUrl && cfg!.webhookSecret
    ? "ready"
    : "not managed (WEBHOOK_URL or HELIUS_WEBHOOK_SECRET missing)";
state.heliusCredits = () => helius.credits;

let stopping = false;
const timers: NodeJS.Timeout[] = [];

/** Run `fn` every `sec` seconds, never overlapping itself, logging failures. */
function every(name: string, sec: number, fn: () => Promise<unknown>) {
  let busy = false;
  const run = async () => {
    if (busy || stopping) return;
    busy = true;
    try {
      await fn();
    } catch (e) {
      console.error(`[worker] ${name} failed:`, e instanceof Error ? e.message : e);
    } finally {
      busy = false;
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
timers.push(
  setInterval(
    () => console.log(`[worker] alive, Helius credits used ~${helius.credits}`),
    10 * 60_000,
  ),
);

function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, shutting down`);
  stopping = true;
  timers.forEach(clearInterval);
  server.close(() => db.end().finally(() => process.exit(0)));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
