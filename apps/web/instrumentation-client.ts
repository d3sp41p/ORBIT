import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./sentry-scrub";

// Browser errors go to Sentry when SENTRY_DSN is set (a DSN is public by design).
if (process.env.SENTRY_DSN)
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
