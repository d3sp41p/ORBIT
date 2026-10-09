/**
 * A temporary planet for a real wallet, so its owner can try sign-in and
 * customisation with their own wallet app before the coin exists. Visible
 * only in preview mode (?preview=<PREVIEW_KEY>) until launch.
 *   tsx scripts/test-planet.ts create <wallet> [days held]
 *   tsx scripts/test-planet.ts remove <wallet>
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isOnCurve, planetName } from "@orbit/core";
import dotenv from "dotenv";
import pg from "pg";
import { Planets } from "../src/planets";

const rootEnv = fileURLToPath(new URL("../../../.env.local", import.meta.url));
if (existsSync(rootEnv)) dotenv.config({ path: rootEnv, quiet: true });

const [cmd, wallet, daysArg] = process.argv.slice(2);
if (!wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) || !isOnCurve(wallet))
  throw new Error("usage: tsx scripts/test-planet.ts create|remove <wallet> [days]");

const db = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

async function remove() {
  for (const t of [
    "ai_jobs",
    "planet_events",
    "planet_finds",
    "planet_chronicle",
    "planet_archive",
    "planet_custom",
    "planet_state",
    "name_reports",
    "holders",
  ])
    await db.query(`delete from ${t} where wallet = $1`, [wallet]);
}

try {
  if (cmd === "remove") {
    await remove();
    console.log(`test planet of ${wallet} removed`);
  } else if (cmd === "create") {
    await remove();
    const days = Number(daysArg ?? 110);
    await db.query(
      `insert into holders (wallet, balance, rank, class, hold_started_at, time_rank, orbit, buys, status, life_no, name)
       values ($1, 5000000000000, 1, 'rocky', now() - make_interval(days => $2), 1, 70, 1, 'alive', 1, $3)`,
      [wallet, days, planetName(wallet)],
    );
    const planets = new Planets(db);
    await planets.lifecycle();
    while ((await planets.ticks(Date.now(), 100)) > 0);
    const { rows } = await db.query(
      `select ps.state->>'era' as era, ps.bible is not null as civ,
         (select count(*)::int from planet_events e where e.wallet = $1) as news
       from planet_state ps where ps.wallet = $1`,
      [wallet],
    );
    console.log(`test planet "${planetName(wallet)}" for ${wallet}:`, rows[0]);
  } else throw new Error("unknown command");
} finally {
  await db.end();
}
