import type { Metadata } from "next";
import AdminPage from "@/components/AdminPage";
import { getPublicToken } from "@/lib/token";

export const metadata: Metadata = {
  title: "Moderation · ORBIT",
  robots: { index: false, follow: false },
};

export default async function Admin() {
  return <AdminPage token={await getPublicToken()} />;
}
