import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  // @orbit/core ships TypeScript sources, so it is bundled into the worker.
  noExternal: ["@orbit/core"],
});
