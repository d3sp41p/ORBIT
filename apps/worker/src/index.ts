import { BALANCE } from "@orbit/core";
import { startHealthServer } from "./health";

const port = Number(process.env.PORT ?? 8080);
const state = { startedAt: new Date() };

const server = startHealthServer(port, state);
console.log(`[worker] started on :${port}, tick every ${BALANCE.tickHours}h`);

// Indexer, simulation ticks and the AI queue arrive in stages 4-6.
const heartbeat = setInterval(() => {
  console.log(`[worker] alive ${new Date().toISOString()}`);
}, 60_000);

function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, shutting down`);
  clearInterval(heartbeat);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
