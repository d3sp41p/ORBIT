import type { ErrorEvent } from "@sentry/nextjs";

/** The preview key travels in ?preview=; it never goes to Sentry. */
const scrubUrl = (u: string | undefined) => u?.replace(/([?&]preview=)[^&#]*/g, "$1[removed]");

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    event.request.url = scrubUrl(event.request.url);
    if (typeof event.request.query_string === "string")
      event.request.query_string = event.request.query_string.replace(
        /(^|&)preview=[^&]*/g,
        "$1preview=[removed]",
      );
    delete event.request.cookies;
    if (event.request.headers) delete event.request.headers.cookie;
  }
  event.breadcrumbs?.forEach((b) => {
    if (typeof b.data?.url === "string") b.data.url = scrubUrl(b.data.url);
    if (typeof b.data?.to === "string") b.data.to = scrubUrl(b.data.to);
    if (typeof b.data?.from === "string") b.data.from = scrubUrl(b.data.from);
  });
  return event;
}
