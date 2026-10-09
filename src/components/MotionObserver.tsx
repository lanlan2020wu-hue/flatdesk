"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { watchPlayBlocks } from "@/lib/play";

// Plays each [data-play] block's animation once it scrolls into view. The CSS
// keeps those animations paused until then only under `@media (scripting: enabled)`,
// so without JavaScript they simply play on load and everything ends up visible.
export default function MotionObserver() {
  const pathname = usePathname();
  useEffect(() => watchPlayBlocks(document), [pathname]);
  return null;
}
