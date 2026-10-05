import Faq from "@/components/Faq";
import StaffingCalculator from "@/components/free-tools/StaffingCalculator";
import ToolShell from "@/components/free-tools/ToolShell";
import { freeToolMeta, webApplication } from "@/lib/free-tool-meta";
import { toolBySlug } from "@/lib/free-tools";
import { faqPage } from "@/lib/seo";

const SLUG = "support-staffing-calculator";
export const metadata = freeToolMeta(SLUG);

const FAQ = [
  {
    q: "How do I calculate how many support agents I need?",
    a: "For live chat and phone, where customers wait in real time, use Erlang C: it takes contacts per hour, average handle time and a service level target (such as 80% answered within 60 seconds) and returns the agents needed to answer. For email, add up the minutes of work a day and divide by the minutes each agent actually spends on tickets. In both cases, add shrinkage on top for breaks, meetings, training and time off.",
  },
  {
    q: "What is Erlang C?",
    a: "A queueing formula from the early 1900s, first used to size telephone exchanges. Given how much work arrives and how many agents are answering, it gives the chance a contact has to wait and how long waits are likely to be. It assumes contacts arrive at random, that they wait rather than give up, and that any agent can take any contact.",
  },
  {
    q: "Does Erlang C overstate the agents I need?",
    a: "It can, slightly. Real customers sometimes give up and leave the queue, which Erlang C doesn't model, so it tends to err on the side of a few more agents. That's usually the safe direction for a plan.",
  },
  {
    q: "What is shrinkage and what should I use?",
    a: "Shrinkage is the share of paid time agents aren't available to customers: breaks, meetings, coaching, training, holidays and sick days. The best figure is your own, from your schedule and time-off records. If you don't track it, add up the hours each agent spends away from the queue in a typical week and divide by their paid hours.",
  },
  {
    q: "How do I staff for chat when agents handle several chats at once?",
    a: "Enter the number of chats each agent usually handles at the same time. The calculator divides handle time by that number, which is the common approximation. In practice each extra chat slows an agent down a little, so treat high concurrency results as optimistic.",
  },
];

export default function Page() {
  const tool = toolBySlug(SLUG);
  return (
    <ToolShell tool={tool} schema={[webApplication(SLUG), faqPage(FAQ)]}>
      <StaffingCalculator />
      <section className="grid max-w-3xl gap-4">
        <h2 className="font-display text-3xl">How the calculation works</h2>
        <ol className="grid list-decimal gap-3 pl-5 text-muted">
          <li><strong className="text-ink">Workload.</strong> Conversations per hour × handle time ÷ 3,600 seconds gives the traffic in erlangs: how many agents would be busy if work arrived perfectly evenly. 60 chats an hour at 6 minutes each is 6 erlangs.</li>
          <li><strong className="text-ink">Queueing.</strong> Work doesn&rsquo;t arrive evenly, so you need more than that. Erlang C gives the chance a customer waits with a given number of agents, and from that the share answered within your target.</li>
          <li><strong className="text-ink">Smallest team that meets the target.</strong> The calculator tries one agent more at a time until the service level reaches your target.</li>
          <li><strong className="text-ink">Shrinkage.</strong> Agents answering ÷ (1 − shrinkage) gives the agents to put on the schedule for that hour.</li>
        </ol>
      </section>
      <Faq items={FAQ} />
    </ToolShell>
  );
}
