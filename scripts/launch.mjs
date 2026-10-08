// Launch control. The worker does the actual switch; these commands only
// change token_config in the database. Reads SUPABASE_DB_URL from .env.local.
//
//   pnpm launch:arm <devWallet> <TICKER> "<Name>" [xUrl]   wait for the coin, switch automatically
//   pnpm launch <mint> [xUrl]                               switch to a coin now (manual)
//   pnpm launch:test <mint>                                 index a coin privately (acceptance tests)
//   pnpm launch:status                                      show what is configured
//   pnpm launch:disarm                                      stop waiting
//   pnpm launch:reset                                       forget the coin, back to the stand-in
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = fileURLToPath(new URL("..", import.meta.url));
dotenv.config({ path: join(root, ".env.local"), quiet: true });
if (!process.env.SUPABASE_DB_URL) {
  console.error("SUPABASE_DB_URL is not set (.env.local).");
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const show = async () => {
  const { rows } = await db.query(
    `select t.mint, t.launched, t.launched_at, t.ticker, t.name, t.buy_url, t.x_url, t.armed,
       t.dev_wallet, t.expected_ticker, t.expected_name, t.excluded_wallets, t.webhook_id,
       t.webhook_addresses, t.indexed_mint = coalesce(t.mint, t.indexed_mint) as data_ready,
       s.holders_count, s.mcap, s.last_webhook_at, s.last_snapshot_at
     from token_config t, system_state s where t.id = 1 and s.id = 1`,
  );
  const r = rows[0];
  console.log(
    r.launched
      ? `LAUNCHED: ${r.ticker ?? "?"} ${r.mint} (since ${r.launched_at?.toISOString()})`
      : r.mint
        ? `TEST: indexing ${r.mint} privately (not shown on the site)`
        : r.armed
          ? `ARMED: waiting for ${r.expected_ticker ?? "?"} / ${r.expected_name ?? "?"} from ${r.dev_wallet}`
          : "IDLE: using the stand-in TOKEN_MINT from the environment",
  );
  console.log({
    buyUrl: r.buy_url,
    xUrl: r.x_url,
    excludedWallets: r.excluded_wallets,
    webhook: r.webhook_id ? `${r.webhook_id} -> ${r.webhook_addresses.join(", ")}` : "none",
    worlds: r.holders_count,
    marketCap: r.mcap,
    lastWebhookAt: r.last_webhook_at,
    lastSnapshotAt: r.last_snapshot_at,
  });
};

try {
  switch (command) {
    case "arm": {
      const [devWallet, ticker, name, xUrl] = args;
      if (!B58.test(devWallet ?? "") || !ticker) {
        console.error('usage: pnpm launch:arm <devWallet> <TICKER> "<Name>" [xUrl]');
        process.exit(1);
      }
      await db.query(
        `update token_config set armed = true, dev_wallet = $1, expected_ticker = $2,
           expected_name = $3, x_url = coalesce($4, x_url), updated_at = now() where id = 1`,
        [devWallet, ticker.replace(/^\$/, ""), name || null, xUrl || null],
      );
      await db.query(`delete from launch_inbox`);
      console.log("Armed. The worker now watches the dev wallet; create the coin on pump.fun.");
      break;
    }
    case "launch": {
      const [mint, xUrl] = args;
      if (!B58.test(mint ?? "")) {
        console.error("usage: pnpm launch <mint> [xUrl]");
        process.exit(1);
      }
      await db.query(
        `update token_config set mint = $1, launched = true, launched_at = now(), armed = false,
           x_url = coalesce($2, x_url), updated_at = now() where id = 1`,
        [mint, xUrl || null],
      );
      console.log("Launched. The worker switches within seconds and restores the history.");
      break;
    }
    case "test": {
      const [mint] = args;
      if (!B58.test(mint ?? "")) {
        console.error("usage: pnpm launch:test <mint>");
        process.exit(1);
      }
      await db.query(
        `update token_config set mint = $1, launched = false, launched_at = null, armed = false,
           updated_at = now() where id = 1`,
        [mint],
      );
      console.log(
        "Test mode: the worker indexes this coin and puts the webhook on it. Nothing is shown publicly. Finish with: pnpm launch:reset",
      );
      break;
    }
    case "disarm":
      await db.query(`update token_config set armed = false, updated_at = now() where id = 1`);
      console.log("Disarmed.");
      break;
    case "reset":
      await db.query(
        `update token_config set mint = null, launched = false, launched_at = null, armed = false,
           ticker = null, name = null, buy_url = null, dev_wallet = null, expected_ticker = null,
           expected_name = null,
           excluded_wallets = array_remove(excluded_wallets, dev_wallet), updated_at = now()
         where id = 1`,
      );
      console.log("Reset. The worker goes back to the stand-in TOKEN_MINT.");
      break;
    case "status":
      break;
    default:
      console.error("commands: arm, launch, test, status, disarm, reset");
      process.exit(1);
  }
  await show();
} finally {
  await db.end();
}
