import { OG_SIZE, ogImage } from "@/lib/og";

export const alt = "Flatdesk: the help desk with one flat price";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogImage({ eyebrow: "Help desk", title: "AI included. The same bill every month." });
}
