import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import Calculator from "@/components/Calculator";
import { calculatorStart } from "@/lib/calculator-query";

export const metadata: Metadata = pageMeta({
  title: "Help desk cost calculator: Zendesk, Intercom, Freshdesk, Help Scout",
  description:
    "Enter your agent count and AI resolutions to compare your Zendesk, Fin (formerly Intercom), Freshdesk or Help Scout bill with one flat price.",
  path: "/calculator",
});

export default async function CalculatorPage({ searchParams }: PageProps<"/calculator">) {
  const start = calculatorStart(await searchParams);
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-14 sm:px-6 sm:pt-20">
      <div className="enter grid max-w-2xl gap-3">
        <h1 className="font-display text-[2.6rem] sm:text-6xl">What is your support tool really costing you?</h1>
        <p className="text-lg text-muted">
          Most help desks now bill AI per resolution, so the bill moves with your ticket volume. Enter your numbers to see this month&apos;s likely bill next to one flat price.
        </p>
      </div>
      {/* Rendered on the server with the shared link's numbers, so the calculator is
          in the first HTML (and visible) instead of being swapped in after hydration. */}
      <Calculator {...start} />
    </div>
  );
}
