/** Minimal Helius client: Solana RPC and the DAS token-accounts listing. */
import type { toChainTx } from "@orbit/core";

type RawTx = Parameters<typeof toChainTx>[0];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TokenAccount {
  address: string;
  owner: string;
  /** Raw amount. */
  amount: bigint;
}

export interface WebhookSpec {
  webhookURL: string;
  accountAddresses: string[];
  authHeader: string;
}

export class Helius {
  private readonly url: string;
  private readonly apiKey: string;
  /** Credits spent by this process (approximate, from the published price list). */
  credits = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }

  /** Token metadata (DAS getAsset, 10 credits). */
  async getAsset(id: string) {
    const a = await this.rpc<{ content?: { metadata?: { name?: string; symbol?: string } } }>(
      "getAsset",
      { id },
      10,
    );
    return { name: a.content?.metadata?.name ?? null, symbol: a.content?.metadata?.symbol ?? null };
  }

  /** Create or update the raw webhook; returns its id. */
  async upsertWebhook(id: string | null, spec: WebhookSpec): Promise<string> {
    const body = JSON.stringify({ ...spec, transactionTypes: ["ANY"], webhookType: "raw" });
    const url = id
      ? `https://api.helius.xyz/v0/webhooks/${id}?api-key=${this.apiKey}`
      : `https://api.helius.xyz/v0/webhooks?api-key=${this.apiKey}`;
    const res = await fetch(url, {
      method: id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!res.ok)
      throw new Error(
        `webhook ${id ? "update" : "create"}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    const j = (await res.json()) as { webhookID: string };
    return j.webhookID;
  }

  async deleteWebhook(id: string) {
    const res = await fetch(`https://api.helius.xyz/v0/webhooks/${id}?api-key=${this.apiKey}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) throw new Error(`webhook delete: HTTP ${res.status}`);
  }

  async rpc<T>(method: string, params: unknown, cost = 1): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let res: Response | undefined;
      try {
        res = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
      } catch {
        // network error: retry below
      }
      if (res && res.status !== 429 && res.status < 500) {
        this.credits += cost;
        const j = (await res.json()) as { result?: T; error?: { message: string } };
        if (j.error) throw new Error(`${method}: ${j.error.message}`);
        return j.result as T;
      }
      if (attempt >= 5) throw new Error(`${method}: HTTP ${res?.status ?? "network error"}`);
      await sleep(1000 * 2 ** attempt);
    }
  }

  getSlot() {
    return this.rpc<number>("getSlot", [{ commitment: "confirmed" }]);
  }

  async getMintInfo(mint: string) {
    const r = await this.rpc<{ value: { amount: string; decimals: number } }>("getTokenSupply", [
      mint,
    ]);
    return { supply: BigInt(r.value.amount), decimals: r.value.decimals };
  }

  /** Every token account of a mint (DAS, 1,000 per page, 10 credits per page). */
  async getTokenAccounts(mint: string): Promise<TokenAccount[]> {
    const out: TokenAccount[] = [];
    for (let page = 1; ; page++) {
      const r = await this.rpc<{
        token_accounts: { address: string; owner: string; amount: number | string }[];
      }>("getTokenAccounts", { mint, page, limit: 1000 }, 10);
      for (const a of r.token_accounts)
        out.push({ address: a.address, owner: a.owner, amount: BigInt(a.amount) });
      if (r.token_accounts.length < 1000) return out;
      await sleep(600); // DAS rate limit on the free plan is 2 requests per second
    }
  }

  getSignatures(address: string, before?: string, limit = 1000) {
    return this.rpc<{ signature: string; slot: number; err: unknown }[]>(
      "getSignaturesForAddress",
      [address, { limit, before, commitment: "confirmed" }],
    );
  }

  getTransaction(signature: string) {
    return this.rpc<RawTx | null>("getTransaction", [
      signature,
      { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" },
    ]);
  }
}
