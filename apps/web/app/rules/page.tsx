import type { Metadata } from "next";
import RulesPage from "@/components/rules/RulesPage";
import { rulesCopy } from "@/orbit/copy";

export const metadata: Metadata = {
  title: `${rulesCopy.title} · ORBIT`,
  description: rulesCopy.metaDescription,
  openGraph: { title: `${rulesCopy.title} · ORBIT`, description: rulesCopy.metaDescription },
};

export default function Rules() {
  return <RulesPage />;
}
