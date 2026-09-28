"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Plays each [data-play] block's animation once, the first time its top edge is
// well inside the viewport, by setting data-play="on". The CSS keeps those
// animations paused until then only under `@media (scripting: enabled)`, so
// without JavaScript they simply play on load and everything ends up visible.
export default function MotionObserver() {
  const pathname = usePathname();

  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-play]:not([data-play='on'])");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => (el.dataset.play = "on"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // Blocks already scrolled past (a reload halfway down) play too.
          if (!e.isIntersecting && e.boundingClientRect.top > 0) continue;
          (e.target as HTMLElement).dataset.play = "on";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -18% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);

  return null;
}
