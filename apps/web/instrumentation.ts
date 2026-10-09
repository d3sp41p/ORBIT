import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./sentry-scrub";

/**
 * Route handlers run in their own server process: load the root .env.local
 * there too. Errors go to Sentry when SENTRY_DSN is set.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadRootEnv } = await import("./load-root-env");
  loadRootEnv(process.cwd());
  if (process.env.SENTRY_DSN)
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? "development",
      tracesSampleRate: 0,
      beforeSend: scrubEvent,
    });
}

export const onRequestError = Sentry.captureRequestError;
