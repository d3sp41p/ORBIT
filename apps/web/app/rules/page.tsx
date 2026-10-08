import type { Metadata } from "next";
import RulesPage from "@/components/rules/RulesPage";
import { getPublicToken } from "@/lib/token";
import { rulesCopy } from "@/orbit/copy";

export const revalidate = 15;

export const metadata: Metadata = {
  title: `${rulesCopy.title} · ORBIT`,
  description: rulesCopy.metaDescription,
  openGraph: { title: `${rulesCopy.title} · ORBIT`, description: rulesCopy.metaDescription },
};

export default async function Rules() {
  return <RulesPage token={await getPublicToken()} />;
}
