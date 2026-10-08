import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Local development keeps one .env.local at the repo root for web and worker.
 * Fills in variables that are not set yet. Does nothing on Vercel, where the
 * file does not exist. (@next/env caches its first load, so it cannot be used
 * for a second directory.)
 */
export function loadRootEnv(webDir: string) {
  const file = resolve(webDir, "../../.env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
    if (!process.env[key]) process.env[key] = value;
  }
}
