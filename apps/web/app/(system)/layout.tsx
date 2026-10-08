import type { ReactNode } from "react";
import OrbitShell from "@/components/OrbitShell";

/** The system view stays mounted across / and /planet/<wallet>. */
export default function SystemLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <OrbitShell />
      {children}
    </>
  );
}
