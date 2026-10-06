import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import Link from "next/link";
import LegalPage, { Section } from "@/components/LegalPage";
import { LEGAL_UPDATED, SITE } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Privacy policy",
  description: "What Flatdesk collects, why, who processes it, and how to get it deleted.",
  path: "/privacy",
});

// Every company that touches customer data, and for what. Keep this in step
// with the services in the README's environment table.
const PROCESSORS: [string, string, string][] = [
  ["Vercel", "Hosting and running the app", "https://vercel.com/legal/privacy-policy"],
  ["Neon", "The database where tickets, messages and attachments are stored", "https://neon.com/privacy-policy"],
  ["Clerk", "Sign-in and team membership", "https://clerk.com/legal/privacy"],
  ["Stripe", "Payments and invoices (card details go to Stripe, never to us)", "https://stripe.com/privacy"],
  ["Resend", "Sending and receiving email", "https://resend.com/legal/privacy-policy"],
  ["Anthropic", "The AI (ticket messages, your team's notes, macros and help articles, sent when an AI feature runs)", "https://www.anthropic.com/legal/privacy"],
];

export default function PrivacyPage() {
  const mail = <a href={`mailto:${SITE.contactEmail}`} className="link text-accent">{SITE.contactEmail}</a>;
  return (
    <LegalPage
      title="Privacy policy"
      updated={LEGAL_UPDATED}
      intro={<p>What {SITE.legalName} collects, what it&apos;s used for, who else handles it, and how to have it removed. Short version: we keep what it takes to run your help desk, and nothing is sold.</p>}
    >
      <Section title="Two kinds of data">
        <p>
          <strong className="font-medium">Your team&apos;s account:</strong> names and email addresses of the people on your team, the team
          name, billing contact and plan, and basic records of use (sign-ins, AI usage counts) that keep the service working and billed
          correctly.
        </p>
        <p>
          <strong className="font-medium">Your customers&apos; conversations:</strong> the emails and chat messages your customers send, the
          files attached to them, your team&apos;s replies and notes, and data you import from another help desk. For this data, your business
          is in charge (the &ldquo;controller&rdquo;) and we process it only on your instructions, to run the service for you (as
          &ldquo;processor&rdquo;).
        </p>
      </Section>

      <Section title="What we use it for">
        <ul className="grid list-disc gap-2 pl-5">
          <li>Running the help desk: receiving and sending email, showing chats, storing tickets and attachments.</li>
          <li>
            AI answers to customers, when your team has them on. They are on for new teams, but nothing reaches a customer until you forward your support email or add the chat widget, and an admin can switch them off in Settings first.
          </li>
          <li>
            Other AI features your team uses: reply drafts and summaries, writing and updating macros, and the AI test drive. These send
            ticket messages to our AI provider even when automatic AI answers are off. To send nothing to the AI provider at all, an admin can turn
            off &ldquo;Allow AI features&rdquo; in Settings, Security.
          </li>
          <li>Billing your team (Stripe sends receipts and payment notices), and emailing admins when the AI allowance is 80% and 100% used.</li>
          <li>Keeping the service secure and fixing problems.</li>
        </ul>
        <p>
          We don&apos;t sell data, show ads, or use your conversations to train AI models. Anthropic, which provides the AI, doesn&apos;t
          train its models on data sent through its API.
        </p>
      </Section>

      <Section title="Who else handles it">
        <p>These companies process data for us, each only for the part of the service listed:</p>
        <ul className="grid gap-2">
          {PROCESSORS.map(([name, what, url]) => (
            <li key={name} className="grid gap-0.5 rounded-lg border border-line bg-surface px-4 py-3 sm:grid-cols-[8rem_1fr] sm:gap-4">
              <a href={url} className="link font-medium text-accent" rel="noopener" target="_blank">{name}</a>
              <span className="text-muted">{what}</span>
            </li>
          ))}
        </ul>
        <p>Most of these are in the United States. Where data moves across borders, we rely on these providers&apos; standard contractual safeguards.</p>
      </Section>

      <Section title="Cookies">
        <p>
          We use cookies to keep you signed in. On our own website, a first-party cookie called fd_src notes where you came from (a
          campaign tag or the site that linked to us). If you sign up, it&apos;s saved with your team so we can see which sources bring
          sign-ups. It lasts 90 days and isn&apos;t shared.
          The website chat widget keeps a conversation token in the visitor&apos;s browser so they can come back to the same chat. There are
          no advertising cookies.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          We keep your data while your team has an account, including after a trial ends or a plan is cancelled, so you can export it or come
          back. Ask us to delete it and we&apos;ll do so within 30 days, apart from records the law requires us to keep, such as invoices.
          People who joined the waitlist can ask to be removed at any time.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can see, correct, export or delete your data. Most of it you can export yourself from Settings. For anything else, including a
          customer of one of our teams asking about their messages (we&apos;ll pass that to the team, since it&apos;s their data), email {mail}.
          If you&apos;re in the EU or UK, you can also complain to your local data protection authority.
        </p>
      </Section>

      <Section title="Security">
        <p>
          The <Link href="/security" className="link text-accent">security page</Link> has the details, including what Flatdesk doesn&apos;t have yet.
        </p>
        <p>
          Data is encrypted in transit and at rest by our hosting and database providers. Attachments can be downloaded only by your team, and
          by the chat visitor they were sent to. API keys for importing from another help desk are encrypted while an import runs and erased
          when it ends. To stop spam, the chat widget, satisfaction ratings and waitlist count requests by a one-way hash of the sender&apos;s IP address.
          We store the hash, not the address.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          If we change this policy in a way that matters, we&apos;ll email team admins before it takes effect. Questions go to {mail}. See also
          our <Link href="/terms" className="link text-accent">terms of service</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
