export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", service: "orbit-web", time: new Date().toISOString() });
}
