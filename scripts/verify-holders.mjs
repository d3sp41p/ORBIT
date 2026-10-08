// Acceptance check for stage 4: compares the balances of N random alive
// holders in the database with the chain (getTokenAccountsByOwner), and
// prints Solscan links for a manual check.
// Usage: node scripts/verify-holders.mjs [count]
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = fileURLToPath(new URL("..", import.meta.url));
dotenv.config({ path: join(root, ".env.local"), quiet: true });
const { SUPABASE_DB_URL, HELIUS_API_KEY, TOKEN_MINT } = process.env;
const count = Number(process.argv[2] || 20);
const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

async function rpc(method, params) {
  const r = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

const db = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(
  `select wallet, balance::text, rank, last_slot::text from holders
   where status = 'alive' order by random() limit $1`,
  [count],
);
let ok = 0;
for (const h of rows) {
  const res = await rpc("getTokenAccountsByOwner", [
    h.wallet,
    { mint: TOKEN_MINT },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  const chain = res.value.reduce(
    (s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount),
    0n,
  );
  const db = BigInt(h.balance);
  let note = "";
  if (chain !== db) {
    // A trade after the last processed slot explains a difference.
    const sigs = await rpc("getSignaturesForAddress", [h.wallet, { limit: 1 }]);
    note =
      sigs[0] && sigs[0].slot > Number(h.last_slot)
        ? " (newer trade, not processed yet)"
        : " MISMATCH";
  } else ok++;
  console.log(
    `${chain === db ? "OK  " : "DIFF"} #${String(h.rank).padEnd(4)} ${h.wallet}  db=${db}  chain=${chain}${note}\n     https://solscan.io/account/${h.wallet}#portfolio`,
  );
}
console.log(`\n${ok}/${rows.length} balances match the chain`);
await db.end();
