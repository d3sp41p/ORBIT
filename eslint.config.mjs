import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";
import tseslint from "typescript-eslint";

const scopeToWeb = (configs) =>
  configs.map((c) =>
    c.ignores && Object.keys(c).length === 1
      ? c
      : { ...c, files: ["apps/web/**/*.{ts,tsx,js,jsx}"] },
  );

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/next-env.d.ts",
      "reference/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  ...scopeToWeb(nextVitals),
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    settings: { next: { rootDir: "apps/web" } },
  },
);
