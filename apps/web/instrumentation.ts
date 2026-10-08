/** Route handlers run in their own server process: load the root .env.local there too. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadRootEnv } = await import("./load-root-env");
  loadRootEnv(process.cwd());
}
