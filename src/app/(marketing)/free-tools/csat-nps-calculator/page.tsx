import Faq from "@/components/Faq";
import SurveyCalculator from "@/components/free-tools/SurveyCalculator";
import ToolShell from "@/components/free-tools/ToolShell";
import { freeToolMeta, webApplication } from "@/lib/free-tool-meta";
import { toolBySlug } from "@/lib/free-tools";
import { faqPage } from "@/lib/seo";

const SLUG = "csat-nps-calculator";
export const metadata = freeToolMeta(SLUG);

const FAQ = [
  {
    q: "How do you calculate CSAT?",
    a: "Count the survey answers rated 4 or 5 on a 1 to 5 scale, divide by all answers, and multiply by 100. 50 satisfied answers out of 60 is a CSAT of 83.3%.",
  },
  {
    q: "How do you calculate NPS?",
    a: "Ask how likely someone is to recommend you on a 0 to 10 scale. 9s and 10s are promoters, 7s and 8s passives, 0 to 6 detractors. NPS is the percentage of promoters minus the percentage of detractors, so 45% promoters and 15% detractors is an NPS of 30.",
  },
  {
    q: "Why does my score jump around from week to week?",
    a: "Mostly chance, when the number of answers is small. With 50 answers, a CSAT can move several points either way with no real change in service. The margin of error above shows how big a move has to be before it means something.",
  },
  {
    q: "What's the difference between CSAT and NPS?",
    a: "CSAT asks about one interaction, usually right after a ticket is solved, so it reflects the support experience. NPS asks about the relationship with the company as a whole, so price, product and support all feed into it. Support teams usually own CSAT; NPS is shared.",
  },
];

export default function Page() {
  return (
    <ToolShell tool={toolBySlug(SLUG)} schema={[webApplication(SLUG), faqPage(FAQ)]}>
      <SurveyCalculator />
      <Faq items={FAQ} />
    </ToolShell>
  );
}
