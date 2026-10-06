"use client";

import { useEffect, useRef } from "react";

// A short silent loop (rendered with Remotion, source in the project files).
// It plays only while on screen and never for visitors who ask for reduced
// motion; they get the poster, which shows the finished comparison.

export default function LoopVideo({ name, label, width, height }: { name: string; label: string; width: number; height: number }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) video.play().catch(() => {});
      else video.pause();
    }, { threshold: 0.25 });
    io.observe(video);
    return () => io.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="metadata"
      poster={`/video/${name}-poster.webp`}
      width={width}
      height={height}
      aria-label={label}
      className="block h-auto w-full"
    >
      <source src={`/video/${name}.mp4`} type="video/mp4" />
      <source src={`/video/${name}.webm`} type="video/webm" />
    </video>
  );
}
