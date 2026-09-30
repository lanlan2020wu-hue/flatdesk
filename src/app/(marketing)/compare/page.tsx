import Link from "next/link";
import CostTable from "@/components/CostTable";
import JsonLd from "@/components/JsonLd";
import { COMPARED_ON, RIVALS, costRows } from "@/lib/compare";
import { breadcrumbs, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Flatdesk compared with Intercom, Zendesk, Help Scout, Freshdesk, Front and Gorgias",
  description:
    "Honest, sourced comparisons of Flatdesk with Intercom (Fin), Zendesk, Help Scout, Freshdesk, Front and Gorgias: monthly cost for real team sizes, how each bills AI, and when each is the better pick.",
  path: "/compare",
});

export default function ComparePage() {
  const rows = [costRows(RIVALS[0])[0], ...RIVALS.flatMap((r) => costRows(r).slice(1))];
  return (
    <div className="mx-auto grid max-w-6xl gap-16 px-4 pt-14 sm:px-6 sm:pt-20">
      <JsonLd data={[breadcrumbs([{ name: "Compare", path: "/compare" }])]} />
      <div className="grid max-w-2xl gap-3">
        <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-[2.6rem] sm:text-6xl">How Flatdesk compares, including where it doesn&apos;t win.</h1>
        <p style={{ "--d": 2 } as React.CSSProperties} className="enter text-lg text-muted">
          Flatdesk isn&apos;t the cheapest seat. It&apos;s the help desk whose AI bill can&apos;t surprise you: AI resolutions come with every seat and
          the AI pauses at the cap. Here is what the same teams pay elsewhere.
        </p>
      </div>

      <section data-play="" aria-label="Comparisons" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {RIVALS.map((r, i) => (
          <Link key={r.slug} href={`/compare/${r.slug}`} style={{ "--i": i } as React.CSSProperties} className="lift card group grid content-start gap-2 p-6">
            <h2 className="font-display text-2xl">Flatdesk vs {r.title}</h2>
            <p className="text-sm text-muted">{r.pickThem.replace(/^You/, "Pick them if you")}</p>
            <span className="lift-link link mt-2 w-max text-sm font-medium text-accent">Read the comparison</span>
          </Link>
        ))}
      </section>

      <section data-play="" aria-labelledby="costs" className="grid gap-6">
        <h2 id="costs" className="ink font-display text-3xl">Monthly cost, side by side</h2>
        <CostTable rows={rows} caption={`List prices checked ${COMPARED_ON}, with annual billing where the vendor offers it, Flatdesk included. "~" marks estimates from third-party reports.`} />
        <p className="text-sm text-muted">
          Vendors count AI differently (Freshdesk counts sessions, Gorgias interactions, Front conversations), so these are close rather than exact.{" "}
          <Link href="/calculator" className="link text-accent">Run your own numbers</Link>.
        </p>
      </section>
    </div>
  );
}
