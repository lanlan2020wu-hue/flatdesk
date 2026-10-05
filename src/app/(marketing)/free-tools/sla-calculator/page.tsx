import Faq from "@/components/Faq";
import SlaCalculator from "@/components/free-tools/SlaCalculator";
import ToolShell from "@/components/free-tools/ToolShell";
import { freeToolMeta, webApplication } from "@/lib/free-tool-meta";
import { toolBySlug } from "@/lib/free-tools";
import { faqPage } from "@/lib/seo";

const SLUG = "sla-calculator";
export const metadata = freeToolMeta(SLUG);

const FAQ = [
  {
    q: "How are business-hours SLAs calculated?",
    a: "The clock only runs while the team is working. Start from the moment the ticket arrives (or the next opening time, if it arrives after hours), count down the target through each working day's open hours, and skip closed hours, weekends and holidays. A 4-hour target on a ticket received Friday at 4pm, with 9-to-5 hours on weekdays, is due Monday at noon.",
  },
  {
    q: "What's a good first response time SLA?",
    a: "One you can meet on almost every ticket with the team you have. Customers expect faster replies on live chat than on email, and urgent issues faster than questions. Set different targets by channel and priority, check your current response times first, and use the staffing calculator to see what a tighter target would cost in agents.",
  },
  {
    q: "What is SLA attainment?",
    a: "The share of tickets that met their SLA target in a period. If 480 tickets came in and 18 missed, attainment is 96.25%.",
  },
  {
    q: "Should the SLA clock pause when we're waiting on the customer?",
    a: "Usually, yes. Most help desks pause resolution-time SLAs while a ticket is pending on the customer, because the team can't move it forward. First response SLAs don't pause, since nobody has replied yet.",
  },
];

export default function Page() {
  return (
    <ToolShell tool={toolBySlug(SLUG)} schema={[webApplication(SLUG), faqPage(FAQ)]}>
      <SlaCalculator />
      <Faq items={FAQ} />
    </ToolShell>
  );
}
