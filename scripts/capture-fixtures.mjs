// Records real transactions of a token as test fixtures (trimmed to the fields
// the indexer reads). Usage: node scripts/capture-fixtures.mjs <mint> <out.json> [limit]
// Uses RPC_URL or the public mainnet RPC. Read-only.
import { writeFileSync } from "node:fs";

const [mint, out, limitArg] = process.argv.slice(2);
if (!mint || !out) {
  console.error("usage: node scripts/capture-fixtures.mjs <mint> <out.json> [limit]");
  process.exit(1);
}
const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const limit = Number(limitArg || 120);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (res.status === 429) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    const j = await res.json();
    if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
    return j.result;
  }
  throw new Error(`${method}: rate limited`);
}

const mintInfo = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
const sigs = await rpc("getSignaturesForAddress", [mint, { limit }]);
const txs = [];
for (const s of sigs) {
  if (s.err) continue;
  const tx = await rpc("getTransaction", [
    s.signature,
    { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" },
  ]);
  if (!tx) continue;
  const keep = (list) => (list || []).filter((b) => b.mint === mint);
  txs.push({
    slot: tx.slot,
    blockTime: tx.blockTime,
    transaction: { signatures: tx.transaction.signatures.slice(0, 1) },
    meta: {
      err: tx.meta.err,
      preTokenBalances: keep(tx.meta.preTokenBalances),
      postTokenBalances: keep(tx.meta.postTokenBalances),
    },
  });
  await sleep(250);
}
writeFileSync(
  out,
  JSON.stringify(
    {
      mint,
      tokenProgram: mintInfo?.value?.owner,
      decimals: mintInfo?.value?.data?.parsed?.info?.decimals,
      supply: mintInfo?.value?.data?.parsed?.info?.supply,
      capturedAt: new Date().toISOString(),
      txs,
    },
    null,
    1,
  ),
);
console.log(`saved ${txs.length} transactions to ${out}`);
