import type { Metadata } from "next";
import Calculator from "@/components/Calculator";

export const metadata: Metadata = {
  title: "Support bill calculator",
  description:
    "Enter your agent count and AI resolutions to compare your Zendesk, Fin (Intercom), Freshdesk or Help Scout bill with one flat price.",
};

const num = (v: string | string[] | undefined, fallback: number) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export default async function CalculatorPage({ searchParams }: PageProps<"/calculator">) {
  const sp = await searchParams;
  const tool = typeof sp.tool === "string" ? sp.tool : "fin-advanced";

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-14 sm:px-6 sm:pt-20">
      <div className="grid max-w-2xl gap-3">
        <p className="eyebrow">Bill calculator</p>
        <h1 className="font-display text-4xl sm:text-5xl">What is your support tool really costing you?</h1>
        <p className="text-lg text-muted">
          AI is now billed per resolution by most help desks, so the bill moves with your ticket volume. Enter your numbers to see this
          month&apos;s likely bill next to one flat price.
        </p>
      </div>
      <Calculator initialTool={tool} initialAgents={num(sp.agents, 10)} initialResolutions={num(sp.resolutions, 1500)} />
    </div>
  );
}
