import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { Section } from "@/components/LegalPage";
import { pageMeta } from "@/lib/seo";
import { SITE, TRUST_UPDATED } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Security",
  description: "How Flatdesk protects your tickets, the controls your admins get, and what Flatdesk doesn't have yet (no SOC 2, no SSO).",
  path: "/security",
});

// What a CTO needs for a vendor review, stated plainly. Every control here
// exists in the app (lib/security.ts, lib/auth.ts, app/app/export); the
// "not yet" list is just as important. Don't add a claim the code can't back.
const NOT_YET = [
  "SOC 2 or ISO 27001 report. Flatdesk is new and hasn't been audited.",
  "An independent penetration test.",
  "Single sign-on (SAML or OIDC) and SCIM provisioning.",
  "An uptime commitment with service credits.",
  "A choice of data region.",
  "HIPAA or PCI scope. Don't send health records through Flatdesk. Card numbers customers paste in anyway are masked when they arrive (see below), but Flatdesk isn't PCI assessed.",
];

export default function SecurityPage() {
  const mail = <a href={`mailto:${SITE.contactEmail}`} className="link text-accent">{SITE.contactEmail}</a>;
  return (
    <LegalPage
      kicker={null}
      title="Security"
      updated={TRUST_UPDATED}
      intro={
        <p>
          What protects your tickets, what your admins control, and what Flatdesk doesn&apos;t have yet. If you&apos;re reviewing Flatdesk as a vendor,
          this page, the <Link href="/dpa" className="link text-accent">data processing addendum</Link> and the{" "}
          <Link href="/privacy" className="link text-accent">privacy policy</Link> are the documents to read.
        </p>
      }
    >
      <Section title="What Flatdesk doesn't have yet">
        <p>Read this first, so nothing below reads as more than it is.</p>
        <ul className="grid list-disc gap-2 pl-5">
          {NOT_YET.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p>If one of these is a requirement for you, Flatdesk isn&apos;t the right fit today. Tell us which, at {mail}, because it decides what we build next.</p>
      </Section>

      <Section title="Controls your admins have">
        <ul className="grid list-disc gap-2 pl-5">
          <li>
            <strong className="font-medium">Required two-step verification.</strong> An admin can require it for the whole team. Anyone without an
            authenticator app on their account is stopped before the help desk opens until they add one.
          </li>
          <li>
            <strong className="font-medium">An off switch for AI.</strong> With &ldquo;Allow AI features&rdquo; off, nothing from your team is sent to
            the AI provider: no AI answers, drafts, summaries, AI macros or test drive. Every call to the AI goes through one check, so no feature
            can skip it. You can try Flatdesk this way and turn AI on later, or never.
          </li>
          <li>
            <strong className="font-medium">Card numbers masked on arrival.</strong> Customers paste card numbers into emails and chats whatever you
            tell them. Any number that looks like a card (13 to 19 digits that pass the card checksum) is replaced with &ldquo;[card number removed,
            ending 4242]&rdquo; before the message is saved, so it never reaches your team or the AI, and the message exports (CSV and JSON) carry the masked text. This
            covers emails, chats, replies and imported tickets. Two places keep what was sent: attachments are stored and exported as the original
            files, and the original-record archive of an import holds what your old help desk returned. Neither is scanned. A number split across
            lines isn&apos;t caught either.
          </li>
          <li>
            <strong className="font-medium">Verified chat for signed-in users.</strong> Your server signs the user&apos;s email with your team&apos;s
            chat secret, so a ticket from your app says who was signed in and whether the signature checked out. A visitor can&apos;t claim to be
            one of your customers by typing their email.
          </li>
          <li>
            <strong className="font-medium">An audit log.</strong> Settings changes, seat changes, exports, imports, AI answer refunds, deleted macros
            and people joining, with who and when. Admins see it in Settings, and it&apos;s in the full export.
          </li>
          <li>
            <strong className="font-medium">Roles.</strong> Admins change settings and billing. Agents answer tickets. Viewers can read but not change
            anything, and aren&apos;t billed. Removing someone from the team in Flatdesk ends their access.
          </li>
          <li>
            <strong className="font-medium">A full export, any time.</strong> One download has every ticket, message, customer, macro, help article,
            the audit log, and every attachment as its original file. Admins don&apos;t need to ask us.
          </li>
          <li>
            <strong className="font-medium">Customer data requests.</strong> When a customer asks for their data or to be forgotten, an admin
            downloads it as a file or erases them, with every ticket, message and file, from any of their tickets. Both are in the audit log.
          </li>
        </ul>
      </Section>

      <Section title="How data is handled">
        <ul className="grid list-disc gap-2 pl-5">
          <li>Data is encrypted in transit (HTTPS only) and at rest by our hosting and database providers.</li>
          <li>
            Every team&apos;s data is kept apart in the database by team, and every page and action checks the signed-in person&apos;s team before reading
            anything. Automated tests check that one team can&apos;t reach another team&apos;s tickets, files or settings.
          </li>
          <li>Attachments can be downloaded only by your team, and by the chat visitor they were sent to.</li>
          <li>API tokens for importing from your old help desk are encrypted while the import runs and erased when it ends.</li>
          <li>Sign-in is handled by Clerk. Flatdesk never sees or stores passwords.</li>
          <li>Card details go to Stripe and never reach Flatdesk.</li>
          <li>The chat widget, ratings and sign-up forms are rate limited, and store a one-way hash of the sender&apos;s IP address rather than the address.</li>
        </ul>
      </Section>

      <Section title="The AI">
        <p>
          AI features use Anthropic&apos;s API. Under Anthropic&apos;s commercial terms, data sent through the API isn&apos;t used to train its models. Flatdesk
          doesn&apos;t use your conversations to train anything either. What&apos;s sent: the ticket being answered, your team&apos;s AI notes, macros and
          help articles. AI answers to customers are on for new teams, but nothing reaches a customer until you forward your support email or add
          the chat widget, and an admin can switch AI answers, or all AI processing, off first.
        </p>
      </Section>

      <Section title="Who processes your data">
        <p>
          Vercel (hosting), Neon (database and files), Clerk (sign-in), Stripe (payments), Resend (email) and Anthropic (AI). Each one&apos;s role and
          privacy policy is listed in the <Link href="/privacy" className="link text-accent">privacy policy</Link>. We give 30 days&apos; notice
          before adding a new one (see the <Link href="/dpa" className="link text-accent">DPA</Link>).
        </p>
      </Section>

      <Section title="Answers to common vendor questions">
        <ul className="grid list-disc gap-2 pl-5">
          <li>
            <strong className="font-medium">Backups.</strong> Tickets, settings and attachments live in a Neon Postgres database, which keeps a restore
            history so it can be rolled back to a point in time inside that window. We haven&apos;t yet run and written up a timed restore drill, so
            there&apos;s no tested recovery time, and no committed RPO or RTO, to quote.
          </li>
          <li>
            <strong className="font-medium">Who can reach production data.</strong> Only Flatdesk&apos;s operator, through the hosting, database and
            email providers&apos; own consoles. There&apos;s no support staff or contractor with access. We look at a team&apos;s tickets only when that
            team asks us to, for support.
          </li>
          <li>
            <strong className="font-medium">Changes.</strong> Every code change goes through a pull request and a preview deployment before it reaches
            production, and the test suite (including the checks that teams can&apos;t see each other&apos;s data) is run before it&apos;s merged.
          </li>
          <li>
            <strong className="font-medium">Logs.</strong> Your admins see the audit log in Settings. Request logs are kept by the hosting provider.
            Message text isn&apos;t written to logs on purpose.
          </li>
          <li>
            <strong className="font-medium">Your questionnaire.</strong> Send it to {mail} and we&apos;ll fill it in. Where the answer is no, it says no.
          </li>
        </ul>
      </Section>

      <Section title="Trying Flatdesk without handing over your data">
        <p>You don&apos;t need to import anything real to see whether Flatdesk works for you.</p>
        <ol className="grid list-decimal gap-2 pl-5">
          <li>Read this page and the <Link href="/dpa" className="link text-accent">DPA</Link>, and send us your questionnaire first if you have one.</li>
          <li>
            Sign up and turn off &ldquo;Allow AI features&rdquo; in Settings, Security, before anything else (the import form has the same switch). With it
            off, nothing goes to the AI provider.
          </li>
          <li>
            Use Test tickets: an admin plays the customer by email or chat and watches how triggers, targets, macros and (if you turn it on) the AI handle
            it. Test tickets stay out of reports and billing and clear in one click.
          </li>
          <li>
            When you&apos;re ready, import. Card numbers in old tickets are masked as they arrive. If you decide against Flatdesk, deleting the account
            removes your data within 30 days.
          </li>
        </ol>
      </Section>

      <Section title="If something goes wrong">
        <p>
          If we learn of a breach affecting your data, we&apos;ll tell your team&apos;s admins without undue delay and within 72 hours, with what we know and
          what we&apos;re doing about it. Deleting your account removes your data within 30 days.
        </p>
      </Section>

      <Section title="Report a vulnerability">
        <p>
          Email {mail} with the details. We&apos;ll reply within two business days and won&apos;t take legal action against good-faith research that
          avoids other teams&apos; data and doesn&apos;t disrupt the service.
        </p>
      </Section>
    </LegalPage>
  );
}
