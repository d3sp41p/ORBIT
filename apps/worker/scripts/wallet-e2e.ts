/**
 * End-to-end check of stage 7 against a running site (default: local dev at
 * http://localhost:3000 started with ADMIN_WALLETS = the test admin key).
 * Test wallets are real ed25519 keys generated for the run; their planet is
 * created in the database and everything is removed at the end.
 *   tsx scripts/wallet-e2e.ts <keys.json> [site]
 *   tsx scripts/wallet-e2e.ts <keys.json> [site] setup|clean   only the test planet
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";
import { planetName } from "@orbit/core";
import dotenv from "dotenv";
import pg from "pg";
import { Planets } from "../src/planets";

const rootEnv = fileURLToPath(new URL("../../../.env.local", import.meta.url));
if (existsSync(rootEnv)) dotenv.config({ path: rootEnv, quiet: true });

type Role = "owner" | "stranger" | "admin";
const keys = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as Record<
  Role,
  { sk: string; pk: string }
>;
const SITE = process.argv[3] ?? "http://localhost:3000";
const PREVIEW = encodeURIComponent(process.env.PREVIEW_KEY ?? "");
const db = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});
const owner = keys.owner.pk;
const wallets = Object.values(keys).map((k) => k.pk);

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function api(
  path: string,
  o: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.origin !== null) headers.origin = o.origin ?? SITE;
  if (o.cookie) headers.cookie = o.cookie;
  const res = await fetch(SITE + path, {
    method: o.method ?? "GET",
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  // Responses are checked field by field below; a loose type keeps the test short.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json().catch(() => null)) as Record<string, any> | null;
  const cookie = res.headers.get("set-cookie")?.match(/orbit_session=[^;]+/)?.[0] ?? "";
  return { status: res.status, json, cookie };
}

async function signIn(role: Role): Promise<string> {
  const { pk, sk } = keys[role];
  const n = await api("/api/auth/nonce", { method: "POST", body: { wallet: pk } });
  const sig = ed25519.sign(new TextEncoder().encode(n.json!.message), Buffer.from(sk, "hex"));
  const v = await api("/api/auth/verify", {
    method: "POST",
    body: { wallet: pk, nonce: n.json!.nonce, signature: Buffer.from(sig).toString("base64") },
  });
  check(`${role} signs in`, v.status === 200 && !!v.cookie, `${v.status}`);
  return v.cookie;
}

const card = async () =>
  (await api(`/api/planet/${owner}?preview=${PREVIEW}&t=${Date.now()}`)).json!.card;

async function createPlanet() {
  await db.query(
    `insert into holders (wallet, balance, rank, class, hold_started_at, time_rank, orbit, buys, status, life_no, name)
     values ($1, 1000000000000, 1, 'rocky', now() - interval '110 days', 1, 70, 1, 'alive', 1, $2)`,
    [owner, planetName(owner)],
  );
  const planets = new Planets(db);
  await planets.lifecycle();
  while ((await planets.ticks(Date.now(), 100)) > 0);
}

async function clean() {
  for (const t of [
    "ai_jobs",
    "planet_events",
    "planet_finds",
    "planet_chronicle",
    "planet_archive",
    "planet_custom",
    "planet_state",
    "name_reports",
    "auth_sessions",
    "auth_nonces",
    "holders",
  ])
    await db.query(`delete from ${t} where wallet = any($1)`, [wallets]);
}

const mode = process.argv[4];
if (mode === "setup" || mode === "clean") {
  await clean();
  if (mode === "setup") await createPlanet();
  await db.end();
  console.log(mode === "setup" ? `test planet ready: ${owner}` : "test data removed");
  process.exit(0);
}

try {
  await clean();
  await createPlanet();
  const before = await card();
  const stock = before.stock as { name: string; species: string | null; capital: string | null };
  console.log(`planet ${stock.name}, species ${stock.species}, capital ${stock.capital}`);

  // Sign-in: a nonce works once, a wrong signature fails, the wrong origin is refused.
  const n = await api("/api/auth/nonce", { method: "POST", body: { wallet: owner } });
  check(
    "message names the domain and says it is not a transaction",
    n.json!.message.startsWith(new URL(SITE).host) && n.json!.message.includes("not a transaction"),
  );
  const bad = await api("/api/auth/verify", {
    method: "POST",
    body: { wallet: owner, nonce: n.json!.nonce, signature: Buffer.alloc(64).toString("base64") },
  });
  check("wrong signature is refused", bad.status === 401, `${bad.status}`);
  const sig = ed25519.sign(
    new TextEncoder().encode(n.json!.message),
    Buffer.from(keys.owner.sk, "hex"),
  );
  const reuse = await api("/api/auth/verify", {
    method: "POST",
    body: { wallet: owner, nonce: n.json!.nonce, signature: Buffer.from(sig).toString("base64") },
  });
  check("a used nonce does not work again", reuse.status === 401, `${reuse.status}`);
  const foreign = await api("/api/auth/nonce", {
    method: "POST",
    body: { wallet: owner },
    origin: "https://evil.example",
  });
  check("requests from another site are refused", foreign.status === 403, `${foreign.status}`);

  const ownerCookie = await signIn("owner");
  const me = await api("/api/auth/me", { cookie: ownerCookie });
  check("session knows the wallet", me.json?.wallet === owner && me.json?.admin === false);

  // Customisation by the owner.
  const values = {
    name: "New Eden",
    species: "Zorgons",
    capital: "Hub Prime",
    motto: "We hold, we grow",
  };
  const save = await api(`/api/planet/${owner}/custom`, {
    method: "PUT",
    body: values,
    cookie: ownerCookie,
  });
  check("owner saves names", save.status === 200, `${save.status}`);
  const after = await card();
  check("card shows the new name", after.name === "New Eden", after.name);
  const texts = [...after.news, ...after.timeline].map((x: { text: string }) => x.text).join("\n");
  const stale = [stock.name, stock.species, stock.capital].filter(
    (s): s is string => !!s && texts.includes(s),
  );
  check("no stock names left in news and timeline", stale.length === 0, stale.join(", "));
  check(
    "new names appear in old news",
    texts.includes("New Eden") || texts.includes("Zorgon") || texts.includes("Hub Prime"),
  );
  const again = await api(`/api/planet/${owner}/custom`, {
    method: "PUT",
    body: { ...values, name: "Eden Two" },
    cookie: ownerCookie,
  });
  check("second change the same day is refused", again.status === 429, `${again.status}`);
  const rude = await api(`/api/planet/${owner}/custom`, {
    method: "PUT",
    body: { ...values, name: "f u c k" },
    cookie: ownerCookie,
  });
  check(
    "profanity is refused",
    rude.status === 422 && rude.json?.error?.code === "offensive",
    `${rude.status} ${rude.json?.error?.code}`,
  );
  const emoji = await api(`/api/planet/${owner}/custom`, {
    method: "PUT",
    body: { ...values, motto: "visit orbit.xyz" },
    cookie: ownerCookie,
  });
  check("links are refused", emoji.status === 422, `${emoji.status}`);
  const search = await api(`/api/search?q=New%20Eden&preview=${PREVIEW}`);
  check(
    "search finds the new name",
    !!search.json?.results?.some((r: { wallet: string }) => r.wallet === owner),
  );

  // Somebody else cannot change it.
  const strangerCookie = await signIn("stranger");
  const steal = await api(`/api/planet/${owner}/custom`, {
    method: "PUT",
    body: { name: "Mine Now" },
    cookie: strangerCookie,
  });
  check(
    "another wallet cannot change it (direct API call)",
    steal.status === 403,
    `${steal.status}`,
  );
  const anon = await api(`/api/planet/${owner}/custom`, {
    method: "PUT",
    body: { name: "Mine Now" },
  });
  check("without a session it is refused", anon.status === 401, `${anon.status}`);
  const forged = await api(`/api/planet/${owner}/custom`, {
    method: "PUT",
    body: { name: "Mine Now" },
    cookie: "orbit_session=forged-token",
  });
  check("a forged session is refused", forged.status === 401, `${forged.status}`);

  // Report and moderation.
  const rep = await api(`/api/planet/${owner}/report`, {
    method: "POST",
    body: { reason: "test report" },
  });
  check("anyone can report the names", rep.status === 200, `${rep.status}`);
  const notAdmin = await api("/api/admin/reports", { cookie: strangerCookie });
  check("reports are admin only", notAdmin.status === 403, `${notAdmin.status}`);
  // Moderation needs the test admin key in ADMIN_WALLETS of the site under test
  // (true for a local run; on production the admins are real wallets).
  const adminCookie = await signIn("admin");
  const adminMe = await api("/api/auth/me", { cookie: adminCookie });
  if (!adminMe.json?.admin) {
    console.log("SKIP  moderation checks: the test admin key is not an admin on this site");
  } else {
    const list = await api("/api/admin/reports", { cookie: adminCookie });
    const item = list.json?.items?.find((i: { wallet: string }) => i.wallet === owner);
    check(
      "admin sees the report with the names",
      item?.custom?.name === "New Eden" && item.reports >= 1,
    );
    const hide = await api(`/api/admin/planet/${owner}/hide`, {
      method: "POST",
      body: { hidden: true },
      cookie: adminCookie,
    });
    check("admin hides the names", hide.status === 200, `${hide.status}`);
    const hidden = await card();
    check("hidden: stock name is shown again", hidden.name === stock.name, hidden.name);
    const pub = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/planet_custom?wallet=eq.${owner}&select=name`,
      { headers: { apikey: process.env.SUPABASE_ANON_KEY! } },
    ).then((r) => r.json());
    check(
      "hidden names are not public in the database API",
      Array.isArray(pub) && pub.length === 0,
    );
  }

  // Restore defaults and log out.
  const restore = await api(`/api/planet/${owner}/custom`, {
    method: "DELETE",
    cookie: ownerCookie,
  });
  check("owner restores the stock names", restore.status === 200, `${restore.status}`);
  const out = await api("/api/auth/logout", { method: "POST", cookie: ownerCookie });
  const gone = await api("/api/auth/me", { cookie: ownerCookie });
  check("log out ends the session", out.status === 200 && gone.json?.wallet === null);

  // Rate limit: 10 sign-in requests a minute per visitor.
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++)
    limited =
      (await api("/api/auth/nonce", { method: "POST", body: { wallet: owner } })).status === 429;
  check("sign-in requests are rate limited", limited);
} finally {
  await clean();
  await db.end();
  console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
}
