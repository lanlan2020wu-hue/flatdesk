import type { Metadata } from "next";
import { Suspense } from "react";
import Calculator, { CALCULATOR_DEFAULTS, CalculatorFromQuery } from "@/components/Calculator";

export const metadata: Metadata = {
  alternates: { canonical: "/calculator" },
  title: "Support bill calculator",
  description:
    "Enter your agent count and AI resolutions to compare your Zendesk, Fin (Intercom), Freshdesk or Help Scout bill with one flat price.",
};

export default function CalculatorPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-14 sm:px-6 sm:pt-20">
      <div className="enter grid max-w-2xl gap-3">
        <h1 className="font-display text-[2.6rem] sm:text-6xl">What is your support tool really costing you?</h1>
        <p className="text-lg text-muted">
          AI is now billed per resolution by most help desks, so the bill moves with your ticket volume. Enter your numbers to see this
          month&apos;s likely bill next to one flat price.
        </p>
      </div>
      {/* The prerendered page shows the default numbers; shared links fill in on the client. */}
      <Suspense fallback={<Calculator {...CALCULATOR_DEFAULTS} />}>
        <CalculatorFromQuery />
      </Suspense>
    </div>
  );
}
