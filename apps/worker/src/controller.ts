/**
 * Token controller: follows token_config and keeps everything else in line.
 * - picks the effective mint (token_config.mint, else TOKEN_MINT stand-in)
 * - on a change of mint: clears the token tables and starts a fresh indexer,
 *   which restores the coin's history from its first block
 * - publishes public token facts to system_state (the site reads them live)
 * - manages the Helius webhook: dev wallet while armed, the coin once launched
 * - while armed: turns a pump.fun create by the dev wallet into the launch
 */
import { launchCandidates, matchesExpected, pumpFunUrl, type RawLaunchTx } from "@orbit/core";
import type { Pool } from "pg";
import type { WorkerConfig } from "./env";
import type { Helius } from "./helius";
import { Indexer } from "./indexer";

const log = (...a: unknown[]) => console.log("[token]", ...a);

interface TokenConfigRow {
  mint: string | null;
  launched: boolean;
  ticker: string | null;
  name: string | null;
  buy_url: string | null;
  x_url: string | null;
  excluded_wallets: string[];
  included_wallets: string[];
  armed: boolean;
  dev_wallet: string | null;
  expected_ticker: string | null;
  expected_name: string | null;
  webhook_id: string | null;
  webhook_addresses: string[];
  indexed_mint: string | null;
  backfilled_mint: string | null;
}

/** Tables that hold data of one coin; cleared when the coin changes. */
const TOKEN_TABLES = [
  "planet_state",
  "planet_events",
  "planet_finds",
  "planet_chronicle",
  "planet_archive",
  "planet_custom",
  "chain_events",
  "holders",
];

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

export class TokenController {
  indexer: Indexer | null = null;
  private mint: string | null = null;
  private warnedNoWebhook = false;

  constructor(
    private readonly db: Pool,
    private readonly helius: Helius,
    private readonly cfg: WorkerConfig,
  ) {}

  private async config(): Promise<TokenConfigRow> {
    const { rows } = await this.db.query<TokenConfigRow>(`select * from token_config where id = 1`);
    return rows[0]!;
  }

  /** One control step: run every few seconds. */
  async tick() {
    let c = await this.config();
    if (c.armed && c.dev_wallet) {
      if (await this.processLaunchInbox(c)) c = await this.config();
    }
    const mint = c.mint ?? this.cfg.mint;
    // Webhook and public facts first: at launch they must not wait for the history.
    await this.publish(c, mint);
    await this.syncWebhook(c, mint);
    if (mint && mint !== this.mint) await this.switchTo(mint, c);
  }

  private async switchTo(mint: string, c: TokenConfigRow) {
    const previous = this.mint;
    this.indexer = null;
    if (c.indexed_mint !== mint) {
      log(
        `switching data to ${c.launched ? "the coin" : "stand-in"} ${mint}: clearing token tables`,
      );
      await this.db.query(`truncate table ${TOKEN_TABLES.join(", ")}`);
      await this.db.query(
        `update system_state set holders_count = 0, mcap = 0, price = 0, star_tier = 0,
           last_snapshot_at = null, updated_at = now() where id = 1`,
      );
      await this.db.query(
        `update token_config set indexed_mint = $1, updated_at = now() where id = 1`,
        [mint],
      );
    }
    const exclusions = {
      excluded: new Set([...this.cfg.exclusions.excluded, ...c.excluded_wallets]),
      included: new Set([...this.cfg.exclusions.included, ...c.included_wallets]),
    };
    const indexer = new Indexer(this.db, this.helius, {
      mint,
      exclusions,
      minHoldingTokens: this.cfg.minHoldingTokens,
      backfillLimit: this.cfg.backfillLimit,
    });
    await indexer.init();
    this.mint = mint;
    log(previous ? `now indexing ${mint}` : `indexing ${mint}`);
    // History first, then live updates (applyPending/snapshot loops use this.indexer).
    const { rows } = await this.db.query<{ backfilled_mint: string | null }>(
      `select backfilled_mint from token_config where id = 1`,
    );
    if (rows[0]?.backfilled_mint !== mint) {
      await indexer.backfill();
      await this.db.query(`update token_config set backfilled_mint = $1 where id = 1`, [mint]);
    }
    this.indexer = indexer;
    await indexer.snapshot();
    await indexer.refreshPrice();
  }

  /** Public token facts for the site. The contract address appears only after launch. */
  private async publish(c: TokenConfigRow, mint: string | null) {
    const launched = c.launched && !!mint;
    await this.db.query(
      `update system_state set token_mint = $1, token_ticker = $2, token_name = $3, buy_url = $4,
         x_url = $5, launched = $6
       where id = 1 and (token_mint is distinct from $1 or token_ticker is distinct from $2
         or token_name is distinct from $3 or buy_url is distinct from $4 or x_url is distinct from $5
         or launched is distinct from $6)`,
      [
        launched ? mint : null,
        c.ticker,
        c.name,
        c.buy_url ?? (launched ? pumpFunUrl(mint!) : null),
        c.x_url,
        launched,
      ],
    );
  }

  /** Keep the Helius webhook pointed at what matters now. */
  private async syncWebhook(c: TokenConfigRow, mint: string | null) {
    const want = c.launched && mint ? [mint] : c.armed && c.dev_wallet ? [c.dev_wallet] : [];
    if (sameList(want, c.webhook_addresses) && (want.length === 0 || c.webhook_id)) return;
    if (!this.cfg.webhookUrl || !this.cfg.webhookSecret) {
      if (want.length && !this.warnedNoWebhook) {
        log("WEBHOOK_URL / HELIUS_WEBHOOK_SECRET not set: cannot manage the Helius webhook");
        this.warnedNoWebhook = true;
      }
      return;
    }
    let id = c.webhook_id;
    if (!want.length) {
      if (id) await this.helius.deleteWebhook(id);
      id = null;
      log("Helius webhook removed");
    } else {
      id = await this.helius.upsertWebhook(id, {
        webhookURL: this.cfg.webhookUrl,
        accountAddresses: want,
        authHeader: this.cfg.webhookSecret,
      });
      log(`Helius webhook ${c.webhook_id ? "updated" : "created"}: watching ${want.join(", ")}`);
    }
    await this.db.query(
      `update token_config set webhook_id = $1, webhook_addresses = $2, updated_at = now() where id = 1`,
      [id, want],
    );
  }

  /** Look for the pump.fun create among dev-wallet transactions. Returns true on launch. */
  private async processLaunchInbox(c: TokenConfigRow): Promise<boolean> {
    const { rows } = await this.db.query<{ sig: string; raw: RawLaunchTx }>(
      `select sig, raw from launch_inbox where not processed order by received_at limit 50`,
    );
    for (const r of rows) {
      await this.db.query(`update launch_inbox set processed = true where sig = $1`, [r.sig]);
      for (const candidate of launchCandidates(r.raw, c.dev_wallet!)) {
        const asset = await this.helius.getAsset(candidate);
        if (!matchesExpected(asset, { ticker: c.expected_ticker, name: c.expected_name })) {
          log(
            `dev wallet created ${candidate} (${asset.symbol} / ${asset.name}): not ours, ignored`,
          );
          continue;
        }
        log(`LAUNCH DETECTED: ${asset.symbol} ${candidate} (tx ${r.sig})`);
        await this.db.query(
          `update token_config set mint = $1, launched = true, launched_at = now(), armed = false,
             ticker = $2, name = $3, buy_url = coalesce(buy_url, $4),
             excluded_wallets = case when $5 = any(excluded_wallets) then excluded_wallets
                                     else array_append(excluded_wallets, $5) end,
             updated_at = now()
           where id = 1`,
          [candidate, asset.symbol, asset.name, pumpFunUrl(candidate), c.dev_wallet],
        );
        return true;
      }
    }
    return false;
  }
}
