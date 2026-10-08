import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  // Bundle every dependency so the Docker image needs only dist/.
  noExternal: [/.*/],
  external: ["pg-native"],
  banner: {
    // CommonJS dependencies (pg) call require() inside the ESM bundle.
    js: `import { createRequire as __orbitCreateRequire } from "node:module"; const require = __orbitCreateRequire(import.meta.url);`,
  },
});
