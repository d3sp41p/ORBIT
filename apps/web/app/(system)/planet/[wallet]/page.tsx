import type { Metadata } from "next";

const shortAddr = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ wallet: string }>;
}): Promise<Metadata> {
  const { wallet } = await params;
  const title = `Planet ${shortAddr(decodeURIComponent(wallet))} · ORBIT`;
  return { title, openGraph: { title } };
}

/** The shell in the (system) layout reads the wallet from the URL and flies to it. */
export default function PlanetPage() {
  return null;
}
