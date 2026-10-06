import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { Section } from "@/components/LegalPage";
import { pageMeta } from "@/lib/seo";
import { SITE, TRUST_UPDATED } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Data processing addendum",
  description: "How Flatdesk processes your customers' personal data for you: instructions, subprocessors, security, breach notice, deletion. Part of the terms.",
  path: "/dpa",
});

// Part of the terms (section 5 links here). Written to cover what GDPR
// Article 28 asks a processor to commit to, and kept in step with /security
// and the processor list on /privacy.
export default function DpaPage() {
  const mail = <a href={`mailto:${SITE.contactEmail}`} className="link text-accent">{SITE.contactEmail}</a>;
  return (
    <LegalPage
      title="Data processing addendum"
      updated={TRUST_UPDATED}
      intro={
        <p>
          This addendum is part of the <Link href="/terms" className="link text-accent">terms of service</Link> between {SITE.legalName} (&ldquo;we&rdquo;,
          the processor) and the business using Flatdesk (&ldquo;you&rdquo;, the controller). It applies whenever we process personal data for you,
          and it applies automatically: there&apos;s nothing to sign. If your company needs a signed copy, email {mail} and we&apos;ll countersign this text.
        </p>
      }
    >
      <Section title="1. What we process">
        <p>
          <strong className="font-medium">Subject matter and purpose:</strong> running your help desk: receiving, storing, showing and sending your
          customers&apos; emails and chats, their attachments, your team&apos;s replies and notes, imported history, and AI features your team uses.
        </p>
        <p>
          <strong className="font-medium">People:</strong> your customers and website visitors who contact you, and the members of your team.{" "}
          <strong className="font-medium">Data:</strong> names, email addresses, message content, files, and anything else they choose to send you.
          You agree not to send special categories of data (such as health data) or card numbers through Flatdesk. Card numbers that arrive anyway are masked before they&apos;re stored, as the security page describes.
        </p>
        <p><strong className="font-medium">Duration:</strong> as long as your account exists, then until deletion under section 8.</p>
      </Section>

      <Section title="2. Your instructions">
        <p>
          We process the data only to provide the service, as these terms and your settings describe, and on your other documented instructions.
          If we believe an instruction breaks data protection law, we&apos;ll tell you. We don&apos;t sell the data or use it to train AI models.
        </p>
      </Section>

      <Section title="3. Confidentiality">
        <p>Anyone we allow to access the data is bound to keep it confidential, and has access only as far as their work needs it.</p>
      </Section>

      <Section title="4. Security">
        <p>
          We keep the technical and organizational measures described on the <Link href="/security" className="link text-accent">security page</Link>,
          including encryption in transit and at rest, separation of each team&apos;s data, required two-step verification when you turn it on, an audit
          log, and an off switch for AI processing. We may improve these measures but won&apos;t make them materially weaker.
        </p>
      </Section>

      <Section title="5. Subprocessors">
        <p>
          You authorize the subprocessors listed in the <Link href="/privacy" className="link text-accent">privacy policy</Link>. We have written terms
          with each that protect the data at least as well as this addendum, and we remain responsible for them. Before adding or replacing a
          subprocessor we&apos;ll email your admins at least 30 days ahead. If you object on reasonable data protection grounds and we can&apos;t address it,
          you can cancel and we&apos;ll refund any prepaid time you haven&apos;t used.
        </p>
      </Section>

      <Section title="6. Helping you">
        <p>
          We&apos;ll help you answer requests from people exercising their rights (access, correction, deletion, export), mostly through the export and
          delete tools in the app. We&apos;ll pass on any such request we receive directly. We&apos;ll also give reasonable help with impact assessments and
          with questions from a data protection authority.
        </p>
      </Section>

      <Section title="7. Breaches">
        <p>
          If we become aware of a breach of security leading to accidental or unlawful loss, change, disclosure of or access to your data, we&apos;ll
          notify your team&apos;s admins without undue delay and within 72 hours, with what we know, the likely effects and what we&apos;re doing about it,
          and keep you updated as we learn more.
        </p>
      </Section>

      <Section title="8. Return and deletion">
        <p>
          You can export everything, attachments included, from Settings at any time. When your account is deleted at your request, we delete the
          data within 30 days, except where the law requires us to keep it.
        </p>
      </Section>

      <Section title="9. Audits">
        <p>
          We&apos;ll answer reasonable written security questionnaires and give you the information needed to show we meet this addendum, once a year or
          after a breach. We don&apos;t have a third-party audit report yet (see the security page).
        </p>
      </Section>

      <Section title="10. Transfers">
        <p>
          The data is processed mainly in the United States. Where data from the EU, UK or Switzerland is transferred, the European Commission&apos;s Standard
          Contractual Clauses (module 2, controller to processor) and the UK addendum apply between us, and are incorporated by reference.
        </p>
      </Section>

      <Section title="11. Order of precedence">
        <p>If this addendum and the terms disagree about personal data, this addendum wins.</p>
      </Section>
    </LegalPage>
  );
}
