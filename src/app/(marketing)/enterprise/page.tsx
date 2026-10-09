import Link from "next/link";
import AiSetupForm from "@/components/AiSetupForm";
import { KNOWLEDGE_LIMITS } from "@/lib/ai";
import { PLAN, usd } from "@/lib/pricing";
import { pageMeta } from "@/lib/seo";
import { TEST_DRIVE } from "@/lib/test-drive";

// The done-for-you AI setup, for larger teams. Everything it describes is
// something the product already does (import, saved answers, website
// knowledge, the test drive, learning from solved tickets); the setup is
// people at Flatdesk doing that work with the team. There's no model
// training or fine-tuning, and the page says so. Don't add a claim the code
// can't back.

export const metadata = pageMeta({
  title: "Done-for-you AI setup for larger support teams",
  description:
    "We set Flatdesk's AI up on your own tickets, macros, help center and docs, and check it against your past tickets before it answers a customer. No model training, and nothing you send trains one.",
  path: "/enterprise",
});

const STEPS = [
  {
    title: "Bring your history in",
    body: "We import your tickets, customers, macros and help center from Zendesk, Intercom, Freshdesk or Help Scout, and keep your old help desk running while we work.",
  },
  {
    title: "Build what the AI reads",
    body: "We turn the replies your team sends most into saved answers, add your docs and website pages, and write the AI's instructions with you: your tone, what it may do, and what it must always hand to a person.",
  },
  {
    title: "Prove it on your own tickets",
    body: `The AI drafts answers to ${TEST_DRIVE.tickets} of your recent tickets, each next to the reply your team actually sent. Your team rates them and we fix the gaps. The AI stays off for customers until you decide to turn it on.`,
  },
  {
    title: "Keep it current",
    body: "Once it's live, Flatdesk can learn from the tickets your team solves: it adds answers for new questions and retires ones your replies show are out of date. Every change is visible, and anyone can edit or delete it.",
  },
];

export default function EnterprisePage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-20 px-4 pt-14 sm:px-6 sm:pt-20">
      <section className="grid max-w-3xl gap-5">
        <p style={{ "--d": 0 } as React.CSSProperties} className="enter font-medium text-accent">Done-for-you AI setup</p>
        <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-[2.6rem] sm:text-6xl">Ready to take your help desk to the next level?</h1>
        <p style={{ "--d": 2 } as React.CSSProperties} className="enter text-lg text-muted">
          For larger support teams: we set Flatdesk&apos;s AI up on your own tickets, macros, help center and docs, then check it against your past
          tickets before it answers a single customer.
        </p>
        <div style={{ "--d": 3 } as React.CSSProperties} className="enter flex flex-wrap gap-3">
          <a href="#request" className="btn btn-primary">Request an AI setup</a>
          <Link href="/pricing" className="btn btn-secondary">See the plan</Link>
        </div>
      </section>

      <section data-play="" suppressHydrationWarning aria-labelledby="steps" className="grid gap-6">
        <h2 id="steps" className="ink font-display text-3xl">What we do with you</h2>
        <ol className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.title} style={{ "--i": i } as React.CSSProperties} className="ln grid content-start gap-2 bg-surface p-6">
              <span className="num text-sm text-muted">{i + 1}</span>
              <h3 className="font-medium">{s.title}</h3>
              <p className="text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="trained" className="grid gap-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <h2 id="trained" className="ink font-display text-3xl">What &ldquo;an AI that knows your business&rdquo; means here</h2>
        <div className="grid gap-4 text-muted">
          <p>
            We don&apos;t train or fine-tune a model on your data. For each ticket, the AI reads your saved answers, help articles and website pages,
            and answers only from them. Nothing you send is used to train any model, ours or Anthropic&apos;s.
          </p>
          <p>
            That has an upside you&apos;ll notice: change an answer and the AI uses the new one on the next ticket; delete it and it&apos;s gone. A
            trained model can&apos;t forget that quickly.
          </p>
          <p>
            It also has a limit. The AI reads up to {KNOWLEDGE_LIMITS.totalChars.toLocaleString("en-US")} characters of knowledge for each answer. If
            yours is bigger, the setup tells you what fits and starts with what answers the most tickets.
          </p>
        </div>
      </section>

      <section aria-labelledby="cost" className="grid gap-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <h2 id="cost" className="ink font-display text-3xl">What it costs</h2>
        <div className="grid gap-4 text-muted">
          <p>
            Your plan doesn&apos;t change: {usd(PLAN.seatPrice)} per agent a month, with {PLAN.includedPerAgent} AI answers per agent included and the
            AI paused at the cap unless you turn on overage. The setup is quoted once we&apos;ve seen how much history and knowledge you have.
          </p>
          <p>
            Before you ask: Flatdesk doesn&apos;t have single sign-on, a SOC 2 report or an uptime commitment yet. The{" "}
            <Link href="/security" className="link text-accent">security page</Link> lists everything that&apos;s missing.
          </p>
        </div>
      </section>

      <section id="request" aria-labelledby="request-title" className="card grid scroll-mt-24 gap-6 p-6 sm:p-8 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div className="grid content-start gap-3">
          <h2 id="request-title" className="ink font-display text-3xl">Request an AI setup</h2>
          <p className="text-muted">Tell us about your team. A person at Flatdesk reads every request and writes back within two business days.</p>
        </div>
        <AiSetupForm />
      </section>
    </div>
  );
}
