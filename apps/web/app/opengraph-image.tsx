import { OG_SIZE, siteImage } from "@/lib/og";

export const alt = "ORBIT: every holder is a world";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 600;

/** Default share image of the site. */
export default function Image() {
  return siteImage();
}
