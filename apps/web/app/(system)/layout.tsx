import type { ReactNode } from "react";
import OrbitShell from "@/components/OrbitShell";
import { getPublicToken } from "@/lib/token";

export const revalidate = 15;

/** The system view stays mounted across / and /planet/<wallet>. */
export default async function SystemLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <OrbitShell token={await getPublicToken()} />
      {children}
    </>
  );
}
