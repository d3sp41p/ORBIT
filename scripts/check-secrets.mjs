// Fails if a secret could reach the browser: scans the client files of the web
// build (apps/web/.next/static). Spec: "Check the build: no secrets in client bundles".
// - Supabase JWTs other than the anon key (service_role)
// - Anthropic keys, database URLs
// - names of server-only variables (code that reads them must not ship)
// - when the variables are set (locally), their actual values
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(root, "apps/web/.next/static");
if (!existsSync(dir)) {
  console.error("No web build found: run pnpm build first.");
  process.exit(1);
}

const SERVER_ONLY = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "HELIUS_API_KEY",
  "HELIUS_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
  "PREVIEW_KEY",
  "ADMIN_WALLETS",
];
const values = SERVER_ONLY.map((k) => [k, process.env[k]?.trim()]).filter(
  ([, v]) => v && v.length >= 12,
);

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|css|html|json|txt|map)$/.test(f)) files.push(p);
  }
};
walk(dir);

const problems = [];
const jwtRole = (token) => {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return payload.role ?? null;
  } catch {
    return null;
  }
};

for (const f of files) {
  const text = readFileSync(f, "utf8");
  const where = relative(root, f);
  for (const m of text.matchAll(/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g)) {
    const role = jwtRole(m[0]);
    if (role && role !== "anon") problems.push(`${where}: a "${role}" key`);
  }
  if (/sk-ant-[\w-]{10,}/.test(text)) problems.push(`${where}: an Anthropic API key`);
  if (/postgres(ql)?:\/\/[^\s"'`]+@/.test(text)) problems.push(`${where}: a database URL`);
  for (const name of SERVER_ONLY)
    if (text.includes(name)) problems.push(`${where}: mentions ${name}`);
  for (const [name, value] of values)
    if (text.includes(value)) problems.push(`${where}: contains the value of ${name}`);
}

if (problems.length) {
  console.error(`Secrets in the client build:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(
  `No secrets in ${files.length} client files` +
    (values.length ? ` (also checked the values of ${values.length} set variables).` : "."),
);
