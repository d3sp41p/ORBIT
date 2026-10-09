import { isWallet } from "@/lib/api";
import { ogPlanet, planetImage, siteImage } from "@/lib/og";

/** Share image of a planet (1200x630). */
export async function GET(_req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const res = isWallet(wallet) ? await planetImage(await ogPlanet(wallet)) : await siteImage();
  res.headers.set("cache-control", "public, s-maxage=600, stale-while-revalidate=3600");
  return res;
}
