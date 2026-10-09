import type { Metadata } from "next";
import { isWallet } from "@/lib/api";
import { ogPlanet } from "@/lib/og";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ wallet: string }>;
}): Promise<Metadata> {
  const wallet = decodeURIComponent((await params).wallet);
  if (!isWallet(wallet)) return { title: "ORBIT · Deep Space Network" };
  const p = await ogPlanet(wallet);
  const title = `${p.name} · ORBIT`;
  const facts = [p.era, p.rank ? `rank #${p.rank}` : null, p.days !== null ? `day ${p.days}` : null]
    .filter(Boolean)
    .join(", ");
  const description = facts
    ? `${p.name}: ${facts}. A world in the ORBIT star system, where every holder is a planet.`
    : `${p.name}, a world in the ORBIT star system, where every holder is a planet.`;
  const image = { url: `/api/og/planet/${wallet}`, width: 1200, height: 630, alt: p.name };
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

/** The shell in the (system) layout reads the wallet from the URL and flies to it. */
export default function PlanetPage() {
  return null;
}
