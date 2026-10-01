import Link from "next/link";
import { CHECK_IT, LEFT_OUT, WHY_CHEAPER } from "@/lib/why-flat";

// Answers "how is it this cheap, and is it any good?" on the homepage and the
// pricing page: where the savings come from, what's left out, and how to
// check the quality on your own tickets before paying.
// The homepage shows what Flatdesk leaves out in its own "is it a fit" section,
// so it can turn that list off here.
export default function WhyFlat({ headingLevel = "h3", leftOut = true }: { headingLevel?: "h2" | "h3"; leftOut?: boolean }) {
  const H = headingLevel;
  return (
    <div className="grid gap-10">
      <div data-play="" className="grid max-w-3xl gap-4">
        <H className="ink font-display text-3xl leading-tight">How this much fits in one seat, and what that doesn&apos;t cut.</H>
        <p className="max-w-[62ch] text-muted">
          A low flat price with this much in it can sound too good to be true. Here is where the difference comes from, what Flatdesk leaves out, and how to
          judge the quality on your own tickets before you pay anything.
        </p>
      </div>

      <ul data-play="" className="grid border-t border-ink/70 sm:grid-cols-2">
        {WHY_CHEAPER.map((r, i) => (
          <li
            key={r.title}
            style={{ "--i": i } as React.CSSProperties}
            className="ln grid content-start gap-1 border-b border-line py-5 sm:odd:pr-8 sm:even:border-l sm:even:pl-8"
          >
            <span className="font-medium">{r.title}</span>
            <span className="text-sm text-muted">{r.body}</span>
          </li>
        ))}
      </ul>

      <div className={`grid gap-10 ${leftOut ? "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16" : ""}`}>
        {leftOut && (
        <div data-play="" className="grid content-start gap-3">
          <p className="font-medium">What Flatdesk doesn&apos;t do</p>
          <ul className="grid gap-2 text-sm text-muted">
            {LEFT_OUT.map((item) => (
              <li key={item} className="flex gap-2.5">
                <span className="mt-[0.72em] h-px w-3 shrink-0 bg-line-strong" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <Link href="/compare" className="link w-max text-sm font-medium text-accent">Where other help desks are ahead</Link>
        </div>
        )}
        <div data-play="" className="grid content-start gap-3">
          <p className="font-medium">Check it before the first charge</p>
          <ul className={`grid border-t border-line sm:grid-cols-2 ${leftOut ? "" : "lg:grid-cols-4"}`}>
            {CHECK_IT.map((c) => (
              <li key={c.title} className="border-b border-line">
                <Link href={c.href} className="group flex h-full flex-col gap-0.5 py-4 text-sm sm:pr-6">
                  <span className="font-medium group-hover:text-accent">{c.title}</span>
                  <span className="text-muted">{c.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
