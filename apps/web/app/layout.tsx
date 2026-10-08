import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ORBIT · Deep Space Network",
  description: "Every holder is a world. A live star system of token holders.",
  openGraph: {
    title: "ORBIT · Deep Space Network",
    description: "Every holder is a world. A live star system of token holders.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
