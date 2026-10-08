// Fails if any Cyrillic character is found in shipped code (apps, packages, supabase).
// Hard rule from CLAUDE.md: the product is English only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

export const CYRILLIC = /[Ѐ-ӿԀ-ԯ]/;

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "out",
  "coverage",
  ".turbo",
  ".vercel",
]);
const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".glb",
  ".gltf",
  ".bin",
  ".wasm",
]);

export function findCyrillic(roots, base = process.cwd()) {
  const hits = [];
  const walk = (path) => {
    let st;
    try {
      st = statSync(path);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(path)) {
        if (!SKIP_DIRS.has(name)) walk(join(path, name));
      }
      return;
    }
    if (BINARY_EXT.has(extname(path).toLowerCase())) return;
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (CYRILLIC.test(line))
        hits.push({ file: relative(base, path), line: i + 1, text: line.trim() });
    });
  };
  for (const root of roots) walk(join(base, root));
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hits = findCyrillic(["apps", "packages", "supabase"]);
  if (hits.length) {
    for (const h of hits) console.error(`${h.file}:${h.line}: ${h.text.slice(0, 120)}`);
    console.error(
      `\nCyrillic check failed: ${hits.length} line(s). The product must be English only.`,
    );
    process.exit(1);
  }
  console.log("Cyrillic check passed.");
}
