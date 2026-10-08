// Applies supabase/migrations/*.sql in order, each once, inside a transaction.
// Needs SUPABASE_DB_URL (Supabase: Project Settings -> Database -> Connection
// string, "Session pooler"). Reads .env.local at the repo root if present.
// Usage: pnpm db:migrate
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = fileURLToPath(new URL("..", import.meta.url));
dotenv.config({ path: join(root, ".env.local"), quiet: true });

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set (see .env.example).");
  process.exit(1);
}

const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  // Bookkeeping lives outside the public schema, so the API never exposes it.
  await client.query(`create schema if not exists orbit_meta;
    create table if not exists orbit_meta.migrations (name text primary key, applied_at timestamptz not null default now());`);
  const done = new Set(
    (await client.query("select name from orbit_meta.migrations")).rows.map((r) => r.name),
  );
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), "utf8");
    process.stdout.write(`applying ${f} ... `);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into orbit_meta.migrations (name) values ($1)", [f]);
      await client.query("commit");
      console.log("ok");
    } catch (e) {
      await client.query("rollback");
      console.log("failed");
      throw e;
    }
  }
  console.log("database is up to date");
} finally {
  await client.end();
}
