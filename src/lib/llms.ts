// llms.txt (https://llmstxt.org): a plain summary of the site for AI answer
// engines and agents, built from the same data as the pages so it can't drift.

import { COMPARED_ON, RIVALS, TEAMS, cheaperAnswer, costRows } from "@/lib/compare";
import { BILLING_FAQ, GENERAL_FAQ } from "@/lib/faq";
import { PLAN, usd } from "@/lib/pricing";
import { DESCRIPTION } from "@/lib/seo";
import { SELLING_POINTS } from "@/lib/selling-points";
import { SITE } from "@/lib/site";

const u = (path: string) => `${SITE.url}${path}`;

export function llmsTxt() {
  return [
    "# Flatdesk",
    "",
    `> ${DESCRIPTION}`,
    "",
    "Key facts:",
    `- Price: ${usd(PLAN.seatPrice)} per agent per month billed monthly with no contract, or ${usd(PLAN.annualSeatPrice)} per agent per month billed yearly (${usd(PLAN.annualSeatPrice * 12)} per agent per year). One plan, every feature.`,
    `- AI: ${PLAN.includedPerAgent} AI resolutions per agent per month included, pooled across the team. The AI pauses at the cap unless an admin turns on overage (${usd(PLAN.overageRate, true)} per resolution).`,
    "- Channels: email and a website chat widget. No phone, SMS or social channels.",
    "- Help center: a simple public help center with search. The AI answers from published articles and links to them.",
    "- Imports from Zendesk, Intercom, Freshdesk and Help Scout.",
    "",
    "## Why teams switch",
    ...SELLING_POINTS.map((p) => `- [${p.name}](${u(`/features/${p.slug}`)}): ${p.short}`),
    "",
    "## Comparisons",
    ...RIVALS.map((r) => `- [Flatdesk vs ${r.title}](${u(`/compare/${r.slug}`)}): pick ${r.name} if ${r.pickThem.charAt(0).toLowerCase() + r.pickThem.slice(1)}`),
    "",
    "## Pricing and tools",
    `- [Pricing](${u("/pricing")}): the one plan and billing questions.`,
    `- [Bill calculator](${u("/calculator")}): compare a Zendesk, Fin, Freshdesk or Help Scout bill with Flatdesk.`,
    `- [FAQ](${u("/faq")}): every question on the site in one place.`,
    `- [2026 AI billing changes](${u("/ai-billing-changes-2026")}): a dated, sourced timeline of Zendesk and Fin changes.`,
    "",
    "## Optional",
    `- [Full text for language models](${u("/llms-full.txt")})`,
    "",
  ].join("\n");
}

const qa = (items: { q: string; a: string }[]) => items.flatMap((f) => [`### ${f.q}`, "", f.a, ""]);

export function llmsFullTxt() {
  const out = [llmsTxt(), "---", "", "# Full text", "", "## About Flatdesk", "", ...qa(GENERAL_FAQ), "## Pricing and billing", "", ...qa(BILLING_FAQ)];
  for (const p of SELLING_POINTS) {
    out.push(`## ${p.name}`, "", `Source: ${u(`/features/${p.slug}`)}`, "", p.answer, "", "How it works:");
    p.steps.forEach((s, i) => out.push(`${i + 1}. ${s.title}: ${s.body}`));
    out.push("", "Facts:", ...p.facts.map((f) => `- ${f}`), "", ...qa(p.faq.filter((f) => !BILLING_FAQ.includes(f))));
  }
  out.push(`## Comparisons (list prices checked ${COMPARED_ON})`, "");
  for (const r of RIVALS) {
    out.push(`### Flatdesk vs ${r.title}`, "", `Source: ${u(`/compare/${r.slug}`)}`, "", r.answer, "");
    out.push(`Monthly cost (${TEAMS.map((t) => t.label).join(" / ")}):`);
    for (const row of costRows(r)) out.push(`- ${row.label}: ${row.costs.map((c) => `${row.approx ? "~" : ""}${usd(c)}`).join(" / ")}. ${row.aiBilling}`);
    out.push("", cheaperAnswer(r), "", "Where Flatdesk is stronger:", ...r.flatdeskWins.map((w) => `- ${w}`));
    out.push("", `Where ${r.name} is stronger:`, ...r.theyWin.map((w) => `- ${w}`), "", `Sources: ${r.sources.map((s) => s.url).join(", ")}`, "");
  }
  return out.join("\n");
}
