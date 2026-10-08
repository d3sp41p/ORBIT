import pg from "pg";
import { loadConfig, type WorkerConfig } from "./env";
import { startHealthServer } from "./health";
import { Helius } from "./helius";
import { Indexer } from "./indexer";

const state = { startedAt: new Date() };
let cfg: WorkerConfig;
try {
  cfg = loadConfig();
} catch (e) {
  // Missing settings must not crash-loop the host: stay up for health checks.
  const port = Number(process.env.PORT ?? 8080);
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
const indexer = new Indexer(db, helius, cfg!);

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

async function main() {
  await indexer.init();
  await indexer.backfillIfEmpty();
  // Webhook events land in chain_events; apply them within seconds.
  void every("apply", 5, () => indexer.applyPending());
  void every("snapshot", cfg!.snapshotSec, () => indexer.snapshot());
  void every("price", 60, () => indexer.refreshPrice());
  timers.push(
    setInterval(
      () => console.log(`[worker] alive, Helius credits used ~${helius.credits}`),
      10 * 60_000,
    ),
  );
}

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});

function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, shutting down`);
  stopping = true;
  timers.forEach(clearInterval);
  server.close(() => db.end().finally(() => process.exit(0)));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
