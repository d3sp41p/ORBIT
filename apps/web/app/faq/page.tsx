import type { Metadata } from "next";
import FaqPage from "@/components/rules/FaqPage";
import { getPublicToken } from "@/lib/token";
import { faqCopy } from "@/orbit/copy";

export const revalidate = 15;

export const metadata: Metadata = {
  title: `${faqCopy.title} · ORBIT`,
  description: faqCopy.metaDescription,
  openGraph: { title: `${faqCopy.title} · ORBIT`, description: faqCopy.metaDescription },
};

export default async function Faq() {
  return <FaqPage token={await getPublicToken()} />;
}
