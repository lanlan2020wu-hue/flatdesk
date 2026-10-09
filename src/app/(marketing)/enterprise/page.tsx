import Link from "next/link";
import AiSetupForm from "@/components/AiSetupForm";
import { KNOWLEDGE_LIMITS } from "@/lib/ai";
import { PLAN, usd } from "@/lib/pricing";
import { pageMeta } from "@/lib/seo";
import { TEST_DRIVE } from "@/lib/test-drive";

// The done-for-you AI setup, for larger teams: people at Flatdesk doing the
// work around the product's import, saved answers, test drive and learning.
// There's no model training or fine-tuning, and the page says so. Don't add a
// claim the code can't back.

export const metadata = pageMeta({
  title: "Done-for-you AI setup for larger support teams",
  description:
    "We set Flatdesk's AI up on your own tickets, macros, help center and docs, and check it against your past tickets before it answers a customer. No model training, and nothing you send trains one.",
  path: "/enterprise",
});

// What Flatdesk does by itself, next to what people at Flatdesk add in the
// setup. The left column must stay true of the product; the right column is
// work we do by hand, so it can't promise anything the app doesn't let us do.
const COMPARE = [
  {
    topic: "Moving in",
    self: "You run the import and get a list of anything that didn't map.",
    setup: "We run it, sort out what didn't map, and set up your tags, routing rules and reply-time targets to match how your team works.",
  },
  {
    topic: "What the AI knows",
    self: "The AI reads the macros, help articles and website pages you already have, then learns from tickets solved in Flatdesk, a few a day.",
    setup: "Before launch, we read your past tickets, list the questions you get most, and write a saved answer for each one your knowledge doesn't cover yet.",
  },
  {
    topic: "Its instructions",
    self: "You write the AI's instructions in Settings.",
    setup: "We write them with you: your tone, and the topics it must always hand to a person, such as refunds, legal questions or cancellations.",
  },
  {
    topic: "Proving it works",
    self: `The AI drafts answers to ${TEST_DRIVE.tickets} of your recent tickets and your team rates them.`,
    setup: "We go through the ratings with your team, fix every answer rated wrong or needing edits, and give you a written report of which questions the AI handles and which stay with people.",
  },
  {
    topic: "After launch",
    self: "Learned answers show up on the Macros page for you to check.",
    setup: "For the first 30 days we read every ticket the AI handed to your team and fill the gaps. After that, you have a named person at Flatdesk to email.",
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

      <section data-play="" suppressHydrationWarning aria-labelledby="compare" className="grid gap-6">
        <div className="grid max-w-2xl gap-3">
          <h2 id="compare" className="ink font-display text-3xl">What the setup adds</h2>
          <p className="text-muted">Flatdesk already does a lot of this on its own. The setup is people at Flatdesk doing the work that software can&apos;t.</p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="hidden grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,5fr)] gap-6 border-b border-line bg-surface-2/70 px-6 py-3 text-sm text-muted md:grid">
            <span />
            <span>Flatdesk on its own</span>
            <span className="text-accent">With the setup</span>
          </div>
          {COMPARE.map((r, i) => (
            <div key={r.topic} style={{ "--i": i } as React.CSSProperties} className="ln grid gap-3 border-b border-line bg-surface px-6 py-5 last:border-b-0 md:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,5fr)] md:gap-6">
              <h3 className="font-medium">{r.topic}</h3>
              <p className="text-muted">
                <span className="block text-sm text-muted md:hidden">On its own</span>
                {r.self}
              </p>
              <p>
                <span className="block text-sm text-accent md:hidden">With the setup</span>
                {r.setup}
              </p>
            </div>
          ))}
        </div>
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
