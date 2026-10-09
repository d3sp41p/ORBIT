/**
 * End-to-end check of the AI texts on the real database, before the coin
 * exists. Test planets get wallets starting with "AiTest" and are removed by
 * "clean"; the site shows them only in preview mode.
 *   tsx scripts/ai-e2e.ts create [count]  planets with history, AI jobs queued
 *   tsx scripts/ai-e2e.ts chronicle      ask for chronicles as the site does
 *   tsx scripts/ai-e2e.ts audit [count]  random AI news: numbers vs template
 *   tsx scripts/ai-e2e.ts write [usd]    run the AI writer here (budget: .env.local or usd)
 *   tsx scripts/ai-e2e.ts status         queue, spend, texts so far
 *   tsx scripts/ai-e2e.ts clean          remove every test planet
 * The worker on the host writes the texts (its AI loop runs without a coin).
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { numbersIn, planetName } from "@orbit/core";
import dotenv from "dotenv";
import pg from "pg";
import { AiWriter } from "../src/ai";
import { Planets } from "../src/planets";

const rootEnv = fileURLToPath(new URL("../../../.env.local", import.meta.url));
if (existsSync(rootEnv)) dotenv.config({ path: rootEnv, quiet: true });

const PREFIX = "AiTest";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const wallet = () => PREFIX + [...randomBytes(38)].map((b) => B58[b % B58.length]).join("");

const db = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});
const [cmd = "status", arg] = process.argv.slice(2);
const like = `${PREFIX}%`;

async function create(n: number) {
  const now = Date.now();
  const classes = ["super", "gas", "ice", "rocky", "rocky", "rocky", "asteroid"];
  for (let i = 0; i < n; i++) {
    const w = wallet();
    // Long holds grow civilizations; every planet has ticks in the last hours.
    const heldDays = 1 + Math.pow(Math.random(), 0.7) * 120;
    await db.query(
      `insert into holders (wallet, balance, rank, class, hold_started_at, time_rank, orbit,
         buys, status, life_no, name)
       values ($1, 1000000000000, $2, $3, $4, $2, $5, 1, 'alive', 1, $6)`,
      [
        w,
        i + 1,
        classes[i % classes.length],
        new Date(now - heldDays * 86_400_000),
        60 + i * 8,
        planetName(w),
      ],
    );
  }
  const planets = new Planets(db);
  await planets.lifecycle();
  let ticked = 0;
  for (let k; (k = await planets.ticks(Date.now(), 100)) > 0;) ticked += k;
  const q = await db.query(
    `select kind, count(*)::int n from ai_jobs where wallet like $1 group by kind order by kind`,
    [like],
  );
  console.log(`${n} test planets, ${ticked} catch-ups; queued:`, q.rows);
}

async function chronicle() {
  const { rows } = await db.query<{ wallet: string }>(
    `select wallet from planet_state where wallet like $1 order by random() limit 3`,
    [like],
  );
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  for (const r of rows) {
    // Same call the site makes when a mission page opens (anon role).
    const res = await fetch(`${url}/rest/v1/rpc/request_chronicle`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ p_wallet: r.wallet }),
    });
    console.log(r.wallet.slice(0, 12), res.status, await res.text());
  }
  // The anon role must not see the queue itself.
  const q = await fetch(`${url}/rest/v1/ai_jobs?select=id&limit=1`, { headers: { apikey: key } });
  console.log("anon reads ai_jobs:", q.status);
}

async function status() {
  const q = await db.query(
    `select kind, count(*)::int n, sum(case when attempts >= 3 then 1 else 0 end)::int failed
     from ai_jobs where wallet like $1 group by kind`,
    [like],
  );
  const t = await db.query(
    `select text_source, count(*)::int n from planet_events where wallet like $1 group by 1`,
    [like],
  );
  const u = await db.query(`select * from ai_usage order by date desc limit 2`);
  const b = await db.query(
    `select count(*)::int n from planet_state where wallet like $1 and bible ? 'lore'`,
    [like],
  );
  const c = await db.query(`select count(*)::int n from planet_chronicle where wallet like $1`, [
    like,
  ]);
  console.log(
    "queue",
    q.rows,
    "\ntexts",
    t.rows,
    "\ncultures",
    b.rows[0].n,
    "chronicles",
    c.rows[0].n,
  );
  console.log("usage", u.rows);
}

async function audit(n: number) {
  const { rows } = await db.query<{
    id: string;
    kind: string;
    text_template: string;
    text_en: string;
    wallet: string;
  }>(
    `select e.id, e.kind, e.text_template, e.text_en, e.wallet from planet_events e
     where e.wallet like $1 and e.text_source = 'ai' order by random() limit $2`,
    [like, n],
  );
  let same = 0;
  for (const r of rows) {
    const names = [planetName(r.wallet)];
    const strip = (s: string) => names.reduce((t, x) => t.split(x).join(" "), s);
    const a = [...new Set(numbersIn(strip(r.text_template)))].sort().join(",");
    const b = [...new Set(numbersIn(strip(r.text_en)))].sort().join(",");
    if (a === b) same++;
    else
      console.log(
        `MISMATCH #${r.id} ${r.kind}\n  template: ${r.text_template}\n  ai:       ${r.text_en}`,
      );
  }
  console.log(`numbers identical in ${same}/${rows.length} random AI news`);
  for (const r of rows.slice(0, 5))
    console.log(`\n${r.kind}\n  template: ${r.text_template}\n  ai:       ${r.text_en}`);
}

/** The worker's AI loop, run here until the queue is empty or the budget says stop. */
async function write(budget: number) {
  const ai = new AiWriter(db, process.env.ANTHROPIC_API_KEY?.trim() || null, budget);
  for (let i = 0; i < 30; i++) {
    await ai.run();
    console.log(ai.status);
    if (/ 0 queued|paused|off/.test(ai.status)) break;
  }
}

async function clean() {
  const tables = [
    "ai_jobs",
    "planet_events",
    "planet_finds",
    "planet_chronicle",
    "planet_archive",
    "planet_state",
    "holders",
  ];
  for (const t of tables) {
    const r = await db.query(`delete from ${t} where wallet like $1`, [like]);
    console.log(t, r.rowCount);
  }
}

try {
  if (cmd === "create") await create(Number(arg ?? 40));
  else if (cmd === "chronicle") await chronicle();
  else if (cmd === "audit") await audit(Number(arg ?? 50));
  else if (cmd === "clean") await clean();
  else if (cmd === "write") await write(Number(arg ?? process.env.AI_DAILY_BUDGET_USD ?? 0));
  else await status();
} finally {
  await db.end();
}
