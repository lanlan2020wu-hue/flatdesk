import Image, { type StaticImageData } from "next/image";

// A page's heading block with a stock photo. "left" and "right" put the photo
// beside the heading on wide screens; "banner" runs it full width under the
// heading. On phones the photo always sits under the heading. grid-cols-1
// keeps the photo's intrinsic width from widening the page on small screens.
// Photos are already small WebP files, so they skip the image optimizer.
export default function PhotoHero({
  photo,
  alt,
  layout = "right",
  children,
}: {
  photo: StaticImageData;
  alt: string;
  layout?: "left" | "right" | "banner";
  children: React.ReactNode;
}) {
  const banner = layout === "banner";
  const grid = banner
    ? "gap-8"
    : layout === "left"
      ? "items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14"
      : "items-center gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14";
  return (
    <div className={`grid grid-cols-1 ${grid}`}>
      {children}
      <Image
        src={photo}
        alt={alt}
        unoptimized
        placeholder="blur"
        priority
        sizes={banner ? "(min-width: 1152px) 1104px, 100vw" : "(min-width: 1024px) 460px, 100vw"}
        style={{ "--d": 3 } as React.CSSProperties}
        className={`enter w-full rounded-[8px] object-cover ${banner ? "aspect-[16/9] object-[center_35%] sm:aspect-[3/1]" : "aspect-[4/3]"} ${layout === "left" ? "lg:order-first" : ""}`}
      />
    </div>
  );
}
