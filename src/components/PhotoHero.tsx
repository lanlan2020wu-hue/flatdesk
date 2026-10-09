import Image, { type StaticImageData } from "next/image";

// A page's heading block with a stock photo beside it on wide screens and
// under it on phones. grid-cols-1 keeps the photo's intrinsic width from
// widening the page on small screens.
export default function PhotoHero({ photo, alt, children, className = "" }: { photo: StaticImageData; alt: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14 ${className}`}>
      {children}
      <Image
        src={photo}
        alt={alt}
        placeholder="blur"
        priority
        sizes="(min-width: 1024px) 460px, 100vw"
        style={{ "--d": 3 } as React.CSSProperties}
        className="enter aspect-[4/3] w-full rounded-[8px] object-cover"
      />
    </div>
  );
}
